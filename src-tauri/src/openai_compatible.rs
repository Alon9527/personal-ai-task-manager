use reqwest::{StatusCode, Url};
use serde::Serialize;
use std::{fmt, future::Future, net::{Ipv4Addr, Ipv6Addr}, time::Duration};

pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const OVERALL_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_ERROR_DETAIL_CHARS: usize = 240;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCategory {
    AuthenticationAuthorization,
    ModelNotFound,
    IncompatibleEndpoint,
    TimeoutTlsNetwork,
    Redirect,
    MalformedResponse,
    LocalServiceUnavailable,
}

impl ErrorCategory {
    fn code(self) -> &'static str {
        match self {
            Self::AuthenticationAuthorization => "authentication/authorization",
            Self::ModelNotFound => "model-not-found",
            Self::IncompatibleEndpoint => "incompatible-endpoint",
            Self::TimeoutTlsNetwork => "timeout/TLS/network",
            Self::Redirect => "redirect",
            Self::MalformedResponse => "malformed-response",
            Self::LocalServiceUnavailable => "local-service-unavailable",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransportError {
    category: ErrorCategory,
    status: Option<u16>,
    detail: Option<String>,
}

impl TransportError {
    fn new(category: ErrorCategory, status: Option<StatusCode>, detail: Option<String>) -> Self {
        Self {
            category,
            status: status.map(|value| value.as_u16()),
            detail,
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn category(&self) -> ErrorCategory {
        self.category
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn status(&self) -> Option<u16> {
        self.status
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.category.code())?;
        if let Some(status) = self.status {
            write!(formatter, " (HTTP {status})")?;
        }
        if let Some(detail) = self.detail.as_deref().filter(|value| !value.is_empty()) {
            write!(formatter, ": {detail}")?;
        }
        Ok(())
    }
}

impl std::error::Error for TransportError {}

pub struct ChatCompletionRequest<'a> {
    pub base_url: &'a str,
    pub api_key: Option<String>,
    pub model: &'a str,
    pub system: Option<&'a str>,
    pub user: &'a str,
    pub max_completion_tokens: u16,
    pub temperature: f32,
    pub top_p: f32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatCompletion {
    pub content: String,
    pub usage: Usage,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Clone, Copy)]
struct TransportTimeouts {
    connect: Duration,
    overall: Duration,
}

struct OwnedCredential {
    bytes: Vec<u8>,
    zeroized: bool,
    #[cfg(test)]
    zeroize_observer: Option<std::sync::Arc<dyn Fn(&[u8]) + Send + Sync>>,
}

impl OwnedCredential {
    fn new(value: String) -> Self {
        Self {
            bytes: value.into_bytes(),
            zeroized: false,
            #[cfg(test)]
            zeroize_observer: None,
        }
    }

    #[cfg(test)]
    fn with_observer(
        value: String,
        zeroize_observer: std::sync::Arc<dyn Fn(&[u8]) + Send + Sync>,
    ) -> Self {
        Self {
            bytes: value.into_bytes(),
            zeroized: false,
            zeroize_observer: Some(zeroize_observer),
        }
    }

    fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes).expect("credential originated from a UTF-8 String")
    }

    fn zeroize(&mut self) {
        if self.zeroized {
            return;
        }
        for byte in &mut self.bytes {
            // SAFETY: `byte` is a valid unique pointer into the owned credential buffer.
            // Volatile writes prevent the compiler from eliding the security erase.
            unsafe { std::ptr::write_volatile(byte, 0) };
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        self.zeroized = true;
        #[cfg(test)]
        if let Some(observer) = &self.zeroize_observer {
            observer(&self.bytes);
        }
    }

    #[cfg(test)]
    fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

impl Drop for OwnedCredential {
    fn drop(&mut self) {
        self.zeroize();
    }
}

struct GuardedChatCompletionRequest<'a> {
    images: &'a [String],
    base_url: &'a str,
    exact_endpoint: bool,
    credential: Option<OwnedCredential>,
    model: &'a str,
    system: Option<&'a str>,
    user: &'a str,
    max_completion_tokens: u16,
    temperature: f32,
    top_p: f32,
}

impl<'a> GuardedChatCompletionRequest<'a> {
    fn new(request: ChatCompletionRequest<'a>) -> Self {
        let ChatCompletionRequest {
            base_url,
            api_key,
            model,
            system,
            user,
            max_completion_tokens,
            temperature,
            top_p,
        } = request;
        Self {
            base_url,
            exact_endpoint: false,
            images: &[],
            credential: api_key.map(OwnedCredential::new),
            model,
            system,
            user,
            max_completion_tokens,
            temperature,
            top_p,
        }
    }

    fn at_endpoint(request: ChatCompletionRequest<'a>) -> Self {
        let mut guarded = Self::new(request);
        guarded.exact_endpoint = true;
        guarded
    }

    #[cfg(test)]
    fn with_zeroize_observer(
        request: ChatCompletionRequest<'a>,
        observer: std::sync::Arc<dyn Fn(&[u8]) + Send + Sync>,
    ) -> Self {
        let ChatCompletionRequest {
            base_url,
            api_key,
            model,
            system,
            user,
            max_completion_tokens,
            temperature,
            top_p,
        } = request;
        Self {
            base_url,
            exact_endpoint: false,
            credential: api_key.map(|value| OwnedCredential::with_observer(value, observer)),
            images: &[],
            model,
            system,
            user,
            max_completion_tokens,
            temperature,
            top_p,
        }
    }
}

#[derive(Serialize)]
struct WireMessage<'a> {
    role: &'static str,
    content: WireContent<'a>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum WireContent<'a> { Text(&'a str), Parts(Vec<serde_json::Value>) }

fn user_content<'a>(text: &'a str, images: &[String]) -> WireContent<'a> {
    if images.is_empty() { return WireContent::Text(text); }
    let mut parts = vec![serde_json::json!({"type":"text","text":text})];
    parts.extend(images.iter().map(|url| serde_json::json!({"type":"image_url","image_url":{"url":url}})));
    WireContent::Parts(parts)
}

#[cfg(test)]
mod image_wire_tests {
    use super::*;
    #[test]
    fn serializes_images_as_parts_but_keeps_text_only_requests_unchanged() {
        assert_eq!(serde_json::to_value(user_content("hello", &[])).unwrap(), serde_json::json!("hello"));
        let value = serde_json::to_value(user_content("analyze", &["data:image/png;base64,AAAA".into()])).unwrap();
        assert_eq!(value[0]["text"], "analyze");
        assert_eq!(value[1]["image_url"]["url"], "data:image/png;base64,AAAA");
    }
}

pub async fn chat_completion_with_images(request: ChatCompletionRequest<'_>, images: &[String]) -> Result<ChatCompletion, TransportError> {
    let mut guarded = GuardedChatCompletionRequest::new(request);
    guarded.images = images;
    chat_completion_guarded(guarded, TransportTimeouts { connect: CONNECT_TIMEOUT, overall: OVERALL_TIMEOUT }, None).await
}

#[derive(Serialize)]
struct ThinkingControl {
    r#type: &'static str,
}

#[derive(Serialize)]
struct CompletionPayload<'a> {
    model: &'a str,
    messages: Vec<WireMessage<'a>>,
    stream: bool,
    max_completion_tokens: u16,
    temperature: f32,
    top_p: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingControl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_split: Option<bool>,
}

#[derive(Serialize)]
struct ConnectionTestPayload<'a> {
    model: &'a str,
    messages: [WireMessage<'a>; 1],
    stream: bool,
    max_tokens: u16,
}

pub fn normalize_base_url(value: &str) -> Result<Url, TransportError> {
    let mut url = Url::parse(value.trim()).map_err(|_| invalid_endpoint("invalid base URL"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid_endpoint("credentials are not allowed in the base URL"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid_endpoint("query strings and fragments are not allowed"));
    }
    let is_loopback = is_local_url(&url);
    match url.scheme() {
        "https" => {}
        "http" if is_loopback => {}
        _ => return Err(invalid_endpoint("remote providers require HTTPS")),
    }
    if url.host().is_none() {
        return Err(invalid_endpoint("base URL requires a host"));
    }
    let trimmed_path = url.path().trim_end_matches('/').to_string();
    url.set_path(if trimmed_path.is_empty() {
        "/"
    } else {
        &trimmed_path
    });
    Ok(url)
}

fn normalize_chat_completions_endpoint(value: &str) -> Result<Url, TransportError> {
    let url = normalize_base_url(value)?;
    if !url.path().ends_with("/chat/completions") {
        return Err(invalid_endpoint("endpoint must end with /chat/completions"));
    }
    Ok(url)
}

pub fn chat_completion(
    request: ChatCompletionRequest<'_>,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + '_ {
    chat_completion_with_timeouts(
        request,
        TransportTimeouts {
            connect: CONNECT_TIMEOUT,
            overall: OVERALL_TIMEOUT,
        },
    )
}

pub fn chat_completion_at_endpoint(
    request: ChatCompletionRequest<'_>,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + '_ {
    chat_completion_guarded(
        GuardedChatCompletionRequest::at_endpoint(request),
        TransportTimeouts {
            connect: CONNECT_TIMEOUT,
            overall: OVERALL_TIMEOUT,
        },
        None,
    )
}

fn chat_completion_with_timeouts(
    request: ChatCompletionRequest<'_>,
    timeouts: TransportTimeouts,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + '_ {
    chat_completion_with_timeouts_and_hook(request, timeouts, None)
}

fn chat_completion_with_timeouts_and_hook<'a>(
    request: ChatCompletionRequest<'a>,
    timeouts: TransportTimeouts,
    before_execute: Option<&'a (dyn Fn(Option<&[u8]>) + Sync)>,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + 'a {
    chat_completion_guarded(
        GuardedChatCompletionRequest::new(request),
        timeouts,
        before_execute,
    )
}

#[cfg(test)]
fn chat_completion_with_zeroize_observer<'a>(
    request: ChatCompletionRequest<'a>,
    timeouts: TransportTimeouts,
    observer: std::sync::Arc<dyn Fn(&[u8]) + Send + Sync>,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + 'a {
    chat_completion_guarded(
        GuardedChatCompletionRequest::with_zeroize_observer(request, observer),
        timeouts,
        None,
    )
}

#[cfg(test)]
fn chat_completion_at_endpoint_with_zeroize_observer<'a>(
    request: ChatCompletionRequest<'a>,
    observer: std::sync::Arc<dyn Fn(&[u8]) + Send + Sync>,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + 'a {
    let mut guarded = GuardedChatCompletionRequest::with_zeroize_observer(request, observer);
    guarded.exact_endpoint = true;
    chat_completion_guarded(
        guarded,
        TransportTimeouts {
            connect: CONNECT_TIMEOUT,
            overall: OVERALL_TIMEOUT,
        },
        None,
    )
}

async fn chat_completion_guarded(
    request: GuardedChatCompletionRequest<'_>,
    timeouts: TransportTimeouts,
    before_execute: Option<&(dyn Fn(Option<&[u8]>) + Sync)>,
) -> Result<ChatCompletion, TransportError> {
    let mut messages = Vec::with_capacity(if request.system.is_some() { 2 } else { 1 });
    if let Some(system) = request.system {
        messages.push(WireMessage {
            role: "system",
            content: WireContent::Text(system),
        });
    }
    messages.push(WireMessage {
        role: "user",
        content: user_content(request.user, request.images),
    });
    let payload = CompletionPayload {
        model: request.model,
        messages,
        stream: false,
        max_completion_tokens: request.max_completion_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        thinking: request.exact_endpoint.then_some(ThinkingControl { r#type: "disabled" }),
        reasoning_split: request.exact_endpoint.then_some(true),
    };
    send_payload_with_hook(
        request.base_url,
        request.exact_endpoint,
        request.credential,
        &payload,
        timeouts,
        before_execute,
    )
    .await
}

pub fn test_connection<'a>(
    base_url: &'a str,
    api_key: Option<String>,
    model: &'a str,
) -> impl Future<Output = Result<ChatCompletion, TransportError>> + 'a {
    let credential = api_key.map(OwnedCredential::new);
    async move {
        let payload = ConnectionTestPayload {
            model,
            messages: [WireMessage {
                role: "user",
                content: WireContent::Text("Reply with OK."),
            }],
            stream: false,
            max_tokens: 8,
        };
        send_payload_with_hook(
            base_url,
            false,
            credential,
            &payload,
            TransportTimeouts {
                connect: CONNECT_TIMEOUT,
                overall: OVERALL_TIMEOUT,
            },
            None,
        )
        .await
    }
}

async fn send_payload_with_hook<T: Serialize + ?Sized>(
    base_url: &str,
    exact_endpoint: bool,
    mut credential: Option<OwnedCredential>,
    payload: &T,
    timeouts: TransportTimeouts,
    before_execute: Option<&(dyn Fn(Option<&[u8]>) + Sync)>,
) -> Result<ChatCompletion, TransportError> {
    let mut endpoint = if exact_endpoint {
        normalize_chat_completions_endpoint(base_url)?
    } else {
        normalize_base_url(base_url)?
    };
    let is_local = is_local_url(&endpoint);
    validate_api_key(credential.as_ref().map(OwnedCredential::as_str), is_local)?;
    let has_credential = credential.is_some();
    if !exact_endpoint {
        endpoint
            .path_segments_mut()
            .map_err(|_| invalid_endpoint("base URL cannot contain path segments"))?
            .pop_if_empty()
            .push("chat")
            .push("completions");
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(timeouts.connect)
        .timeout(timeouts.overall)
        .build()
        .map_err(|_| safe_network_error(is_local, false))?;
    let mut builder = client.post(endpoint).json(payload);
    if let Some(credential) = credential.as_ref() {
        builder = builder.bearer_auth(credential.as_str());
    }
    let request = builder
        .build()
        .map_err(|_| invalid_endpoint("could not build provider request"))?;
    if let Some(credential) = credential.as_mut() {
        credential.zeroize();
    }
    if let Some(hook) = before_execute {
        #[cfg(test)]
        hook(credential.as_ref().map(OwnedCredential::bytes));
        #[cfg(not(test))]
        hook(None);
    }
    let response = client
        .execute(request)
        .await
        .map_err(|error| safe_network_error(is_local, error.is_timeout()))?;
    let status = response.status();
    if status.is_redirection() {
        return Err(TransportError::new(
            ErrorCategory::Redirect,
            Some(status),
            None,
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(credential_safe_response_error(
            malformed(Some(status), "response body exceeds 2 MiB"),
            has_credential,
        ));
    }
    let body = read_bounded(response, is_local)
        .await
        .map_err(|error| credential_safe_response_error(error, has_credential))?;
    if !status.is_success() {
        return Err(http_error(status, &body, has_credential, is_local));
    }
    parse_completion(&body, status)
        .map_err(|error| credential_safe_response_error(error, has_credential))
}

async fn read_bounded(
    mut response: reqwest::Response,
    is_local: bool,
) -> Result<Vec<u8>, TransportError> {
    let status = response.status();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| {
            let mut mapped = safe_network_error(is_local, error.is_timeout());
            mapped.status = Some(status.as_u16());
            mapped
        })?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(malformed(Some(status), "response body exceeds 2 MiB"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_completion(body: &[u8], status: StatusCode) -> Result<ChatCompletion, TransportError> {
    let value: serde_json::Value = serde_json::from_slice(body)
        .map_err(|_| malformed(Some(status), "response is not valid JSON"))?;
    let choices = value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .filter(|choices| !choices.is_empty())
        .ok_or_else(|| malformed(Some(status), "response choices are missing or empty"))?;
    if matches!(choices[0].get("finish_reason").and_then(serde_json::Value::as_str), Some("length" | "max_tokens")) {
        return Err(malformed(Some(status), "模型输出达到长度上限，结果被截断。未采用不完整建议，请缩短输入后重试。"));
    }
    let content = choices[0]
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| malformed(Some(status), "response content is not a non-empty string"))?
        .to_string();
    let usage_value = match value.get("usage") {
        None | Some(serde_json::Value::Null) => None,
        Some(usage @ serde_json::Value::Object(_)) => Some(usage),
        Some(_) => return Err(malformed(Some(status), "response usage is not an object")),
    };
    let prompt_tokens = parse_usage_token(usage_value, "prompt_tokens", status)?;
    let completion_tokens = parse_usage_token(usage_value, "completion_tokens", status)?;
    let reported_total = parse_usage_token(usage_value, "total_tokens", status)?;
    let total_tokens = if reported_total == 0 {
        prompt_tokens.saturating_add(completion_tokens)
    } else {
        reported_total
    };
    Ok(ChatCompletion {
        content,
        usage: Usage {
            prompt_tokens,
            completion_tokens,
            total_tokens,
        },
    })
}

fn parse_usage_token(
    usage: Option<&serde_json::Value>,
    field: &str,
    status: StatusCode,
) -> Result<u64, TransportError> {
    match usage.and_then(|value| value.get(field)) {
        None => Ok(0),
        Some(value) => value
            .as_u64()
            .ok_or_else(|| malformed(Some(status), "response usage contains a non-integer value")),
    }
}

fn http_error(
    status: StatusCode,
    body: &[u8],
    has_credential: bool,
    is_local: bool,
) -> TransportError {
    let raw_detail = response_error_detail(body);
    let category_text = raw_detail.to_ascii_lowercase();
    let category = if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        ErrorCategory::AuthenticationAuthorization
    } else if category_text.contains("model_not_found")
        || category_text.contains("model not found")
        || category_text.contains("unknown model")
    {
        ErrorCategory::ModelNotFound
    } else if is_local && status.is_server_error() {
        ErrorCategory::LocalServiceUnavailable
    } else if status.is_server_error() {
        ErrorCategory::TimeoutTlsNetwork
    } else {
        ErrorCategory::IncompatibleEndpoint
    };
    let detail = (!has_credential).then(|| sanitize_detail(&raw_detail));
    TransportError::new(category, Some(status), detail)
}

fn response_error_detail(body: &[u8]) -> String {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
        {
            let code = value
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            return format!("{code} {message}").trim().to_string();
        }
    }
    String::from_utf8_lossy(body).into_owned()
}

fn sanitize_detail(value: &str) -> String {
    let mut sanitized: String = value
        .chars()
        .map(|character| if character.is_control() { ' ' } else { character })
        .collect();
    let lowercase = sanitized.to_ascii_lowercase();
    if lowercase.contains("authorization") || lowercase.contains("bearer") {
        sanitized = "[redacted]".to_string();
    }
    sanitized.chars().take(MAX_ERROR_DETAIL_CHARS).collect()
}

fn invalid_endpoint(detail: &str) -> TransportError {
    TransportError::new(
        ErrorCategory::IncompatibleEndpoint,
        None,
        Some(detail.to_string()),
    )
}

fn malformed(status: Option<StatusCode>, detail: &str) -> TransportError {
    TransportError::new(
        ErrorCategory::MalformedResponse,
        status,
        Some(detail.to_string()),
    )
}

fn safe_network_error(is_local: bool, _is_timeout: bool) -> TransportError {
    let category = if is_local {
        ErrorCategory::LocalServiceUnavailable
    } else {
        ErrorCategory::TimeoutTlsNetwork
    };
    TransportError::new(category, None, None)
}

fn credential_safe_response_error(
    mut error: TransportError,
    has_credential: bool,
) -> TransportError {
    if has_credential {
        error.detail = None;
    }
    error
}

fn is_local_url(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address == Ipv4Addr::LOCALHOST,
        Some(url::Host::Ipv6(address)) => address == Ipv6Addr::LOCALHOST,
        None => false,
    }
}

fn validate_api_key(api_key: Option<&str>, is_local: bool) -> Result<(), TransportError> {
    if !is_local && api_key.is_none() {
        return Err(TransportError::new(
            ErrorCategory::AuthenticationAuthorization,
            None,
            None,
        ));
    }
    if api_key.is_some_and(|value| {
        value.is_empty() || value.chars().any(|character| character.is_whitespace() || character.is_control())
    }) {
        return Err(TransportError::new(
            ErrorCategory::AuthenticationAuthorization,
            None,
            None,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            mpsc::{self, Receiver},
            Arc,
        },
        thread,
        time::Duration,
    };

    #[derive(Debug)]
    struct CapturedRequest {
        request_line: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    struct TestServer {
        base_url: String,
        request: Receiver<CapturedRequest>,
        worker: thread::JoinHandle<()>,
    }

    impl TestServer {
        fn respond(status: &str, headers: &[(&str, String)], body: Vec<u8>) -> Self {
            Self::respond_after(Duration::ZERO, status, headers, body)
        }

        fn respond_without_length(status: &str, headers: &[(&str, String)], body: Vec<u8>) -> Self {
            Self::start(Duration::ZERO, status, headers, body, false)
        }

        fn respond_after(
            delay: Duration,
            status: &str,
            headers: &[(&str, String)],
            body: Vec<u8>,
        ) -> Self {
            Self::start(delay, status, headers, body, true)
        }

        fn start(
            delay: Duration,
            status: &str,
            headers: &[(&str, String)],
            response_body: Vec<u8>,
            add_content_length: bool,
        ) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
            let address = listener.local_addr().expect("fixture address");
            let base_url = format!("http://{address}/v1/");
            let status = status.to_string();
            let headers: Vec<(String, String)> = headers
                .iter()
                .map(|(name, value)| ((*name).to_string(), value.clone()))
                .collect();
            let (sender, request) = mpsc::channel();
            let worker = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept fixture request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("set fixture read timeout");
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let count = stream.read(&mut buffer).expect("read fixture request");
                    assert!(count > 0, "request ended before its headers");
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(index) = find_bytes(&bytes, b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let header_text = String::from_utf8(bytes[..header_end].to_vec())
                    .expect("fixture request headers are UTF-8");
                let mut lines = header_text.split("\r\n");
                let request_line = lines.next().unwrap_or_default().to_string();
                let parsed_headers: Vec<(String, String)> = lines
                    .filter(|line| !line.is_empty())
                    .map(|line| {
                        let (name, value) = line.split_once(':').expect("valid request header");
                        (name.trim().to_string(), value.trim().to_string())
                    })
                    .collect();
                let content_length = parsed_headers
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.parse::<usize>().ok())
                    .unwrap_or(0);
                while bytes.len() - header_end < content_length {
                    let count = stream.read(&mut buffer).expect("read fixture request body");
                    assert!(count > 0, "request body ended early");
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let body = String::from_utf8(bytes[header_end..header_end + content_length].to_vec())
                    .expect("fixture request body is UTF-8");
                sender
                    .send(CapturedRequest {
                        request_line,
                        headers: parsed_headers,
                        body: body.clone(),
                    })
                    .expect("capture fixture request");
                thread::sleep(delay);
                let mut response = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
                if add_content_length
                    && !headers
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                {
                    response.push_str(&format!("Content-Length: {}\r\n", response_body.len()));
                }
                for (name, value) in &headers {
                    response.push_str(name);
                    response.push_str(": ");
                    response.push_str(value);
                    response.push_str("\r\n");
                }
                response.push_str("\r\n");
                if stream.write_all(response.as_bytes()).is_ok() {
                    let _ = stream.write_all(&response_body);
                }
            });
            Self {
                base_url,
                request,
                worker,
            }
        }

        fn finish(self) -> CapturedRequest {
            let request = self
                .request
                .recv_timeout(Duration::from_secs(2))
                .expect("receive fixture request");
            self.worker.join().expect("join fixture server");
            request
        }
    }

    fn response(status: &str, body: Vec<u8>) -> TestServer {
        TestServer::respond(
            status,
            &[("Content-Type", "application/json".to_string())],
            body,
        )
    }

    fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|window| window == needle)
    }

    fn valid_response() -> Vec<u8> {
        br#"{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":0}}"#.to_vec()
    }

    #[test]
    fn token_limit_response_is_rejected_even_if_content_is_valid_json() {
        for reason in ["length", "max_tokens"] {
            let body = serde_json::json!({"choices":[{"finish_reason":reason,"message":{"content":"{\"goals\":[]}"}}]}).to_string();
            let error = parse_completion(body.as_bytes(), StatusCode::OK).expect_err("truncated completions must not be accepted");
            assert!(error.to_string().contains("截断"));
        }
    }

    fn call(server: &TestServer, api_key: Option<&str>) -> Result<ChatCompletion, TransportError> {
        tauri::async_runtime::block_on(chat_completion(ChatCompletionRequest {
            base_url: &server.base_url,
            api_key: api_key.map(str::to_string),
            model: "synthetic-model",
            system: Some("Synthetic system prompt"),
            user: "Synthetic user prompt",
            max_completion_tokens: 123,
            temperature: 0.2,
            top_p: 0.9,
        }))
    }

    fn exact_endpoint(server: &TestServer) -> String {
        format!("{}/chat/completions", server.base_url.trim_end_matches('/'))
    }

    fn call_exact(server: &TestServer, api_key: Option<&str>) -> Result<ChatCompletion, TransportError> {
        let endpoint = exact_endpoint(server);
        tauri::async_runtime::block_on(chat_completion_at_endpoint(ChatCompletionRequest {
            base_url: &endpoint,
            api_key: api_key.map(str::to_string),
            model: "MiniMax-M3",
            system: Some("Synthetic MiniMax system prompt"),
            user: "Synthetic MiniMax user prompt",
            max_completion_tokens: 1800,
            temperature: 0.2,
            top_p: 0.9,
        }))
    }

    #[test]
    fn built_in_exact_endpoint_seam_reuses_the_reviewed_request_and_bounds() {
        let server = response("200 OK", valid_response());
        call_exact(&server, Some("synthetic-built-in-secret")).expect("valid built-in completion");
        let captured = server.finish();
        assert_eq!(captured.request_line, "POST /v1/chat/completions HTTP/1.1");
        let body: serde_json::Value = serde_json::from_str(&captured.body).unwrap();
        assert_eq!(body["model"], "MiniMax-M3");
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_completion_tokens"], 1800);
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["top_p"], 0.9);
        assert_eq!(body["thinking"]["type"], "disabled");
        assert_eq!(body["reasoning_split"], true);
    }

    #[test]
    fn built_in_exact_endpoint_rejects_redirect_without_second_contact() {
        let second = TcpListener::bind("127.0.0.1:0").expect("bind redirect probe");
        second.set_nonblocking(true).expect("nonblocking redirect probe");
        let location = format!("http://{}/must-not-run", second.local_addr().unwrap());
        let server = TestServer::respond("302 Found", &[("Location", location)], Vec::new());

        let error = call_exact(&server, Some("synthetic-built-in-secret")).unwrap_err();
        assert_eq!(error.category(), ErrorCategory::Redirect);
        assert_eq!(error.status(), Some(302));
        server.finish();
        thread::sleep(Duration::from_millis(50));
        assert!(matches!(second.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock));
    }

    #[test]
    fn built_in_exact_endpoint_rejects_oversize_and_retains_safe_status_without_reflected_secret() {
        let oversized = TestServer::respond(
            "200 OK",
            &[("Content-Length", (MAX_RESPONSE_BYTES + 1).to_string())],
            Vec::new(),
        );
        let error = call_exact(&oversized, Some("synthetic-built-in-secret")).unwrap_err();
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        assert_eq!(error.status(), Some(200));
        oversized.finish();

        let secret = "synthetic-reflected-built-in-secret";
        let reflected = response("418 I'm a teapot", secret.as_bytes().to_vec());
        let error = call_exact(&reflected, Some(secret)).unwrap_err();
        assert_eq!(error.status(), Some(418));
        assert!(!error.to_string().contains(secret));
        reflected.finish();
    }

    #[test]
    fn dropping_unpolled_built_in_exact_endpoint_future_zeroes_owned_credential() {
        let zeroize_count = Arc::new(AtomicUsize::new(0));
        let observed_count = zeroize_count.clone();
        let observer: Arc<dyn Fn(&[u8]) + Send + Sync> = Arc::new(move |bytes| {
            assert!(bytes.iter().all(|byte| *byte == 0));
            observed_count.fetch_add(1, Ordering::SeqCst);
        });
        let future = chat_completion_at_endpoint_with_zeroize_observer(
            ChatCompletionRequest {
                base_url: "https://api.minimaxi.com/v1/chat/completions",
                api_key: Some("synthetic-unpolled-built-in-secret".to_string()),
                model: "MiniMax-M3",
                system: None,
                user: "Synthetic prompt",
                max_completion_tokens: 8,
                temperature: 0.2,
                top_p: 0.9,
            },
            observer,
        );
        drop(future);
        assert_eq!(zeroize_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn accepts_only_remote_https_and_loopback_http_base_urls() {
        assert!(normalize_base_url("https://api.openai.com/v1").is_ok());
        assert!(normalize_base_url("http://localhost:11434/v1").is_ok());
        assert!(normalize_base_url("http://LOCALHOST:11434/v1").is_ok());
        assert!(normalize_base_url("http://127.0.0.1:11434/v1/").is_ok());
        assert!(normalize_base_url("http://[::1]:1234/v1").is_ok());
        assert!(normalize_base_url("http://127.0.0.2:11434/v1").is_err());
        assert!(normalize_base_url("http://127.1.0.1:11434/v1").is_err());
        assert!(normalize_base_url("http://api.example.com/v1").is_err());
        assert!(normalize_base_url("https://user:pass@example.com/v1").is_err());
        assert!(normalize_base_url("https://example.com/v1?q=1").is_err());
        assert!(normalize_base_url("https://example.com/v1#fragment").is_err());
    }

    #[test]
    fn appends_chat_completions_to_the_base_path_once() {
        let server = response("200 OK", valid_response());
        call(&server, None).expect("valid completion");
        let captured = server.finish();
        assert_eq!(captured.request_line, "POST /v1/chat/completions HTTP/1.1");
    }

    #[test]
    fn strips_all_trailing_base_path_slashes_before_appending_endpoint() {
        let server = response("200 OK", valid_response());
        let base_url = format!("{}///", server.base_url);
        let completion = tauri::async_runtime::block_on(chat_completion(ChatCompletionRequest {
            base_url: &base_url,
            api_key: None,
            model: "synthetic-model",
            system: None,
            user: "Synthetic prompt",
            max_completion_tokens: 8,
            temperature: 0.2,
            top_p: 0.9,
        }));
        completion.expect("valid completion");
        let captured = server.finish();
        assert_eq!(captured.request_line, "POST /v1/chat/completions HTTP/1.1");
        assert_eq!(
            normalize_base_url("https://example.com/v1///")
                .expect("valid base URL")
                .path(),
            "/v1"
        );
        assert_eq!(
            normalize_base_url("https://example.com///")
                .expect("valid root base URL")
                .path(),
            "/"
        );
    }

    #[test]
    fn keyed_profile_sends_exactly_one_bearer_header() {
        let server = response("200 OK", valid_response());
        call(&server, Some("synthetic-super-secret")).expect("valid completion");
        let captured = server.finish();
        let authorization: Vec<_> = captured
            .headers
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("authorization"))
            .collect();
        assert_eq!(authorization.len(), 1);
        assert_eq!(authorization[0].1, "Bearer synthetic-super-secret");
    }

    #[test]
    fn owned_credential_is_zeroed_after_request_build_and_before_execute() {
        let server = response("200 OK", valid_response());
        let zeroed_before_execute = AtomicBool::new(false);
        let hook = |bytes: Option<&[u8]>| {
            let bytes = bytes.expect("credential buffer exists");
            assert_eq!(bytes.len(), "synthetic-super-secret".len());
            assert!(bytes.iter().all(|byte| *byte == 0));
            zeroed_before_execute.store(true, Ordering::SeqCst);
        };
        let request = ChatCompletionRequest {
            base_url: &server.base_url,
            api_key: Some("synthetic-super-secret".to_string()),
            model: "synthetic-model",
            system: None,
            user: "Synthetic prompt",
            max_completion_tokens: 8,
            temperature: 0.2,
            top_p: 0.9,
        };
        tauri::async_runtime::block_on(chat_completion_with_timeouts_and_hook(
            request,
            TransportTimeouts {
                connect: Duration::from_secs(1),
                overall: Duration::from_secs(1),
            },
            Some(&hook),
        ))
        .expect("valid completion");
        assert!(zeroed_before_execute.load(Ordering::SeqCst));
        let captured = server.finish();
        assert!(captured
            .headers
            .iter()
            .any(|(name, value)| name.eq_ignore_ascii_case("authorization")
                && value == "Bearer synthetic-super-secret"));
    }

    #[test]
    fn dropping_unpolled_future_zeroes_owned_credential() {
        let zeroize_count = Arc::new(AtomicUsize::new(0));
        let observed_count = Arc::clone(&zeroize_count);
        let observer: Arc<dyn Fn(&[u8]) + Send + Sync> = Arc::new(move |bytes| {
            assert_eq!(bytes.len(), "synthetic-unpolled-secret".len());
            assert!(bytes.iter().all(|byte| *byte == 0));
            observed_count.fetch_add(1, Ordering::SeqCst);
        });
        let future = chat_completion_with_zeroize_observer(
            ChatCompletionRequest {
                base_url: "https://provider.invalid/v1",
                api_key: Some("synthetic-unpolled-secret".to_string()),
                model: "synthetic-model",
                system: None,
                user: "Synthetic prompt",
                max_completion_tokens: 8,
                temperature: 0.2,
                top_p: 0.9,
            },
            TransportTimeouts {
                connect: Duration::from_millis(10),
                overall: Duration::from_millis(10),
            },
            observer,
        );
        assert_eq!(zeroize_count.load(Ordering::SeqCst), 0);
        drop(future);
        assert_eq!(zeroize_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn validation_error_zeroes_owned_credential() {
        let zeroize_count = Arc::new(AtomicUsize::new(0));
        let observed_count = Arc::clone(&zeroize_count);
        let observer: Arc<dyn Fn(&[u8]) + Send + Sync> = Arc::new(move |bytes| {
            assert_eq!(bytes.len(), "synthetic-validation-secret".len());
            assert!(bytes.iter().all(|byte| *byte == 0));
            observed_count.fetch_add(1, Ordering::SeqCst);
        });
        let error = tauri::async_runtime::block_on(chat_completion_with_zeroize_observer(
            ChatCompletionRequest {
                base_url: "not a URL",
                api_key: Some("synthetic-validation-secret".to_string()),
                model: "synthetic-model",
                system: None,
                user: "Synthetic prompt",
                max_completion_tokens: 8,
                temperature: 0.2,
                top_p: 0.9,
            },
            TransportTimeouts {
                connect: Duration::from_millis(10),
                overall: Duration::from_millis(10),
            },
            observer,
        ))
        .expect_err("invalid URL must fail");
        assert_eq!(error.category(), ErrorCategory::IncompatibleEndpoint);
        assert_eq!(zeroize_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn no_key_profile_sends_no_authorization_header() {
        let server = response("200 OK", valid_response());
        call(&server, None).expect("valid completion");
        let captured = server.finish();
        assert!(!captured
            .headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("authorization")));
    }

    #[test]
    fn request_preserves_completion_parameters_and_disables_streaming() {
        let server = response("200 OK", valid_response());
        call(&server, None).expect("valid completion");
        let captured = server.finish();
        let body: serde_json::Value = serde_json::from_str(&captured.body).expect("request JSON");
        assert_eq!(body["model"], "synthetic-model");
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_completion_tokens"], 123);
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["top_p"], 0.9);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["role"], "user");
        assert!(body.get("thinking").is_none());
        assert!(body.get("reasoning_split").is_none());
    }

    #[test]
    fn connection_test_uses_only_small_max_tokens_and_ok_prompt() {
        let server = response("200 OK", valid_response());
        tauri::async_runtime::block_on(test_connection(
            &server.base_url,
            None,
            "synthetic-model",
        ))
        .expect("valid connection test");
        let captured = server.finish();
        let body: serde_json::Value = serde_json::from_str(&captured.body).expect("request JSON");
        assert_eq!(body["max_tokens"], 8);
        assert_eq!(body["messages"], serde_json::json!([{"role":"user","content":"Reply with OK."}]));
        assert_eq!(body["stream"], false);
        assert!(body.get("max_completion_tokens").is_none());
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
    }

    #[test]
    fn redirect_is_rejected_without_contacting_its_location() {
        let second = TcpListener::bind("127.0.0.1:0").expect("bind redirect probe");
        second.set_nonblocking(true).expect("nonblocking redirect probe");
        let location = format!("http://{}/should-not-be-called", second.local_addr().unwrap());
        let server = TestServer::respond(
            "302 Found",
            &[("Location", location), ("X-Fixture-Body-Length", "0".to_string())],
            Vec::new(),
        );
        let error = call(&server, None).expect_err("redirect must fail");
        assert_eq!(error.category(), ErrorCategory::Redirect);
        server.finish();
        thread::sleep(Duration::from_millis(50));
        assert!(matches!(second.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock));
    }

    #[test]
    fn authentication_error_redacts_secret_and_authorization_patterns() {
        let secret = "synthetic-super-secret";
        let body = format!(
            r#"{{"error":{{"message":"Authorization: Bearer {secret}","code":"invalid_api_key"}}}}"#
        );
        let server = response("401 Unauthorized", body.into_bytes());
        let error = call(&server, Some(secret)).expect_err("authentication must fail");
        let rendered = error.to_string();
        assert_eq!(error.category(), ErrorCategory::AuthenticationAuthorization);
        assert!(!rendered.contains(secret));
        assert!(!rendered.to_ascii_lowercase().contains("bearer"));
        assert!(!rendered.to_ascii_lowercase().contains("authorization:"));
        server.finish();
    }

    #[test]
    fn credentialed_error_never_includes_upstream_detail() {
        let secret = "synthetic-super-secret";
        let server = response("400 Bad Request", secret.as_bytes().to_vec());
        let error = call(&server, Some(secret)).expect_err("request must fail");
        assert_eq!(error.status(), Some(400));
        assert!(error.detail.is_none());
        assert!(!error.to_string().contains(secret));
        server.finish();
    }

    #[test]
    fn credentialed_malformed_response_exposes_only_status_and_category() {
        let server = response("200 OK", b"reflected-or-malformed-content".to_vec());
        let error = call(&server, Some("synthetic-super-secret"))
            .expect_err("malformed response must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        assert_eq!(error.status(), Some(200));
        assert!(error.detail.is_none());
        server.finish();
    }

    #[test]
    fn no_key_error_redacts_mixed_case_authorization_and_bearer_patterns() {
        for body in ["aUtHoRiZaTiOn: opaque", "bEaReR opaque"] {
            let server = response("400 Bad Request", body.as_bytes().to_vec());
            let error = call(&server, None).expect_err("request must fail");
            assert_eq!(error.detail.as_deref(), Some("[redacted]"));
            let rendered = error.to_string().to_ascii_lowercase();
            assert!(!rendered.contains("authorization:"));
            assert!(!rendered.contains("bearer"));
            server.finish();
        }
    }

    #[test]
    fn no_key_error_replaces_cr_lf_and_control_characters() {
        let sanitized = sanitize_detail("first\r\nsecond\0third\u{7f}");
        assert_eq!(sanitized, "first  second third ");
        assert!(!sanitized.chars().any(char::is_control));
    }

    #[test]
    fn no_key_error_detail_is_capped_at_240_unicode_characters() {
        let sanitized = sanitize_detail(&"界".repeat(MAX_ERROR_DETAIL_CHARS + 1));
        assert_eq!(sanitized.chars().count(), MAX_ERROR_DETAIL_CHARS);
        assert_eq!(sanitized.len(), MAX_ERROR_DETAIL_CHARS * "界".len());
    }

    #[test]
    fn model_not_found_has_stable_category_and_status() {
        let server = response(
            "404 Not Found",
            br#"{"error":{"message":"model not found","code":"model_not_found"}}"#.to_vec(),
        );
        let error = call(&server, None).expect_err("missing model must fail");
        assert_eq!(error.category(), ErrorCategory::ModelNotFound);
        assert_eq!(error.status(), Some(404));
        server.finish();
    }

    #[test]
    fn incompatible_endpoint_has_stable_category() {
        let server = response("405 Method Not Allowed", b"wrong endpoint".to_vec());
        let error = call(&server, None).expect_err("incompatible endpoint must fail");
        assert_eq!(error.category(), ErrorCategory::IncompatibleEndpoint);
        server.finish();
    }

    #[test]
    fn empty_choices_are_rejected_as_malformed() {
        let server = response("200 OK", br#"{"choices":[]}"#.to_vec());
        let error = call(&server, None).expect_err("empty choices must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        server.finish();
    }

    #[test]
    fn non_string_content_is_rejected_as_malformed() {
        let server = response(
            "200 OK",
            br#"{"choices":[{"message":{"content":[{"type":"text","text":"OK"}]}}]}"#.to_vec(),
        );
        let error = call(&server, None).expect_err("non-string content must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        server.finish();
    }

    #[test]
    fn non_numeric_usage_is_rejected_as_malformed() {
        let server = response(
            "200 OK",
            br#"{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":"2"}}"#
                .to_vec(),
        );
        let error = call(&server, None).expect_err("non-numeric usage must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        server.finish();
    }

    #[test]
    fn content_length_over_two_mib_is_rejected_before_body_read() {
        let server = TestServer::respond(
            "200 OK",
            &[("Content-Length", (MAX_RESPONSE_BYTES + 1).to_string())],
            Vec::new(),
        );
        let error = call(&server, None).expect_err("oversized content length must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        server.finish();
    }

    #[test]
    fn unknown_length_body_over_two_mib_is_rejected_while_streaming() {
        let body = vec![b'x'; MAX_RESPONSE_BYTES + 1];
        let server = TestServer::respond_without_length(
            "200 OK",
            &[("Content-Type", "application/json".to_string())],
            body,
        );
        let error = call(&server, None).expect_err("oversized body must fail");
        assert_eq!(error.category(), ErrorCategory::MalformedResponse);
        server.finish();
    }

    #[test]
    fn local_timeout_has_local_service_unavailable_category() {
        let body = valid_response();
        let server = TestServer::respond_after(
            Duration::from_millis(150),
            "200 OK",
            &[("Content-Type", "application/json".to_string())],
            body,
        );
        let request = ChatCompletionRequest {
            base_url: &server.base_url,
            api_key: None,
            model: "synthetic-model",
            system: None,
            user: "Synthetic prompt",
            max_completion_tokens: 8,
            temperature: 0.2,
            top_p: 0.9,
        };
        let error = tauri::async_runtime::block_on(chat_completion_with_timeouts(
            request,
            TransportTimeouts {
                connect: Duration::from_millis(50),
                overall: Duration::from_millis(50),
            },
        ))
        .expect_err("timeout must fail");
        assert_eq!(error.category(), ErrorCategory::LocalServiceUnavailable);
        server.finish();
    }

    #[test]
    fn local_midstream_disconnect_has_local_service_unavailable_category() {
        let server = TestServer::respond(
            "200 OK",
            &[
                ("Content-Type", "application/json".to_string()),
                ("Content-Length", "1024".to_string()),
            ],
            b"partial".to_vec(),
        );
        let error = call(&server, None).expect_err("truncated response must fail");
        assert_eq!(error.category(), ErrorCategory::LocalServiceUnavailable);
        assert_eq!(error.status(), Some(200));
        server.finish();
    }

    #[test]
    fn remote_https_without_key_is_rejected_before_execute() {
        let execute_count = AtomicUsize::new(0);
        let hook = |_bytes: Option<&[u8]>| {
            execute_count.fetch_add(1, Ordering::SeqCst);
        };
        let request = ChatCompletionRequest {
            base_url: "https://provider.invalid/v1",
            api_key: None,
            model: "synthetic-model",
            system: None,
            user: "Synthetic prompt",
            max_completion_tokens: 8,
            temperature: 0.2,
            top_p: 0.9,
        };
        let error = tauri::async_runtime::block_on(chat_completion_with_timeouts_and_hook(
            request,
            TransportTimeouts {
                connect: Duration::from_millis(10),
                overall: Duration::from_millis(10),
            },
            Some(&hook),
        ))
        .expect_err("remote profile without a key must fail");
        assert_eq!(error.category(), ErrorCategory::AuthenticationAuthorization);
        assert_eq!(execute_count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn valid_response_returns_content_and_normalized_usage() {
        let server = response("200 OK", valid_response());
        let completion = call(&server, None).expect("valid completion");
        assert_eq!(completion.content, "OK");
        assert_eq!(completion.usage.prompt_tokens, 2);
        assert_eq!(completion.usage.completion_tokens, 1);
        assert_eq!(completion.usage.total_tokens, 3);
        server.finish();
    }
}
