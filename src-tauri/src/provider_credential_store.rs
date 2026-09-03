use uuid::Uuid;

const CREDENTIAL_TARGET_PREFIX: &str = "com.focusai.taskmanager/model-provider/";
const MAX_SECRET_BYTES: usize = 4096;
const UNSUPPORTED: &str = "unsupported: Windows Credential Manager is unavailable";

pub(crate) fn credential_target(profile_id: &str) -> Result<String, String> {
    let profile_id = Uuid::parse_str(profile_id)
        .map_err(|_| "模型服务商 ID 必须是有效 UUID".to_string())?;
    Ok(format!("{CREDENTIAL_TARGET_PREFIX}{}", profile_id.hyphenated()))
}

fn validate_provider_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
        return Err(format!(
            "API Key 必须为 1–{MAX_SECRET_BYTES} 字节"
        ));
    }
    if secret.contains(['\0', '\r', '\n']) || secret.chars().any(char::is_whitespace) {
        return Err("API Key 不能包含空白或控制字符".to_string());
    }
    Ok(())
}

fn decode_provider_secret(blob: Option<Vec<u8>>) -> Result<Option<String>, String> {
    let Some(blob) = blob else {
        return Ok(None);
    };
    let secret = match String::from_utf8(blob) {
        Ok(secret) => secret,
        Err(error) => {
            let mut invalid = error.into_bytes();
            invalid.fill(0);
            return Err("Windows 凭据中的 API Key 已损坏".to_string());
        }
    };
    if let Err(error) = validate_provider_secret(&secret) {
        let mut invalid = secret.into_bytes();
        invalid.fill(0);
        return Err(error);
    }
    Ok(Some(secret))
}

pub fn exists(profile_id: &str) -> Result<bool, String> {
    let target = credential_target(profile_id)?;
    platform::exists(&target)
}

pub(crate) fn read(profile_id: &str) -> Result<Option<String>, String> {
    let target = credential_target(profile_id)?;
    decode_provider_secret(platform::read(&target)?)
}

pub fn save(profile_id: &str, api_key: String) -> Result<(), String> {
    let mut secret = api_key.into_bytes();
    let result = (|| {
        let target = credential_target(profile_id)?;
        let secret_text = std::str::from_utf8(&secret)
            .map_err(|_| "API Key 必须是有效 UTF-8".to_string())?;
        validate_provider_secret(secret_text)?;
        platform::save(&target, &mut secret)
    })();
    secret.fill(0);
    result
}

pub fn delete(profile_id: &str) -> Result<(), String> {
    let target = credential_target(profile_id)?;
    platform::delete(&target)
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, ptr};

    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    pub fn exists(target: &str) -> Result<bool, String> {
        let target = wide(target);
        let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(false);
            }
            return Err(format!("读取 Windows 凭据状态失败（错误 {error}）"));
        }
        if credential_ptr.is_null() {
            return Err("Windows 凭据返回了空记录".to_string());
        }
        unsafe { scrub_credential_and_free(credential_ptr) };
        Ok(true)
    }

    pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
        let target = wide(target);
        let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!("读取 Windows 凭据失败（错误 {error}）"));
        }
        if credential_ptr.is_null() {
            return Err("Windows 凭据返回了空记录".to_string());
        }

        let blob = unsafe {
            let credential = &*credential_ptr;
            if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
                .to_vec()
            }
        };
        unsafe { scrub_credential_and_free(credential_ptr) };
        Ok(Some(blob))
    }

    pub fn save(target: &str, secret: &mut [u8]) -> Result<(), String> {
        let mut target = wide(target);
        let mut username = wide("Focus AI Model Provider");
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = secret.len() as u32;
        credential.CredentialBlob = secret.as_ptr().cast_mut();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_mut_ptr();

        let ok = unsafe { CredWriteW(&credential, 0) };
        let error = unsafe { GetLastError() };
        secret.fill(0);
        if ok == 0 {
            return Err(format!("保存 Windows 凭据失败（错误 {error}）"));
        }
        Ok(())
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error != ERROR_NOT_FOUND {
                return Err(format!("删除 Windows 凭据失败（错误 {error}）"));
            }
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn scrub_credential_and_free(credential_ptr: *mut CREDENTIALW) {
        if credential_ptr.is_null() {
            return;
        }
        let credential = unsafe { &mut *credential_ptr };
        if !credential.CredentialBlob.is_null() {
            for index in 0..credential.CredentialBlobSize as usize {
                unsafe { std::ptr::write_volatile(credential.CredentialBlob.add(index), 0) };
            }
            std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        }
        unsafe { CredFree(credential_ptr.cast::<c_void>()) };
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::UNSUPPORTED;

    pub fn exists(_target: &str) -> Result<bool, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn read(_target: &str) -> Result<Option<Vec<u8>>, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn save(_target: &str, secret: &mut [u8]) -> Result<(), String> {
        secret.fill(0);
        Err(UNSUPPORTED.to_string())
    }

    pub fn delete(_target: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_is_namespaced_by_canonical_uuid() {
        assert_eq!(
            credential_target("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            "com.focusai.taskmanager/model-provider/550e8400-e29b-41d4-a716-446655440000"
        );
        assert_eq!(
            credential_target("550E8400E29B41D4A716446655440000").unwrap(),
            "com.focusai.taskmanager/model-provider/550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[test]
    fn custom_provider_targets_cannot_alias_the_legacy_minimax_credential_target() {
        let custom_target = credential_target("550e8400-e29b-41d4-a716-446655440000").unwrap();
        assert_ne!(custom_target, "com.focusai.taskmanager/minimax-api-key");

        let provider_source = include_str!("model_provider.rs");
        let production_source = provider_source.split("#[cfg(test)]").next().unwrap();
        assert!(!production_source.contains("crate::credential_store::"));
        assert!(!production_source.contains("minimax-api-key"));
    }

    #[test]
    fn rejects_non_uuid_ids_and_secret_control_characters() {
        assert!(credential_target("../minimax-api-key").is_err());
        assert!(validate_provider_secret("abc\r\nInjected").is_err());
        assert!(validate_provider_secret(&"x".repeat(4097)).is_err());
    }

    #[test]
    fn accepts_only_secrets_within_the_strict_byte_and_character_boundary() {
        assert!(validate_provider_secret("").is_err());
        assert!(validate_provider_secret("x").is_ok());
        assert!(validate_provider_secret(&"界".repeat(1365)).is_ok());
        assert!(validate_provider_secret(&"界".repeat(1366)).is_err());

        for whitespace in [' ', '\t', '\n', '\r', '\u{00a0}', '\u{2003}'] {
            assert!(
                validate_provider_secret(&format!("secret{whitespace}value")).is_err(),
                "Unicode whitespace {whitespace:?} must be rejected"
            );
        }
        assert!(validate_provider_secret("secret\0value").is_err());
    }

    #[test]
    fn stored_secret_bytes_are_validated_before_use() {
        assert_eq!(
            decode_provider_secret(Some(b"synthetic-secret".to_vec())).unwrap(),
            Some("synthetic-secret".to_string())
        );
        assert!(decode_provider_secret(Some(b"bad\nsecret".to_vec())).is_err());
        assert!(decode_provider_secret(Some(vec![0xff, 0xfe])).is_err());
        assert!(decode_provider_secret(Some(Vec::new())).is_err());
        assert_eq!(decode_provider_secret(None).unwrap(), None);
    }

    #[test]
    fn native_write_zeroes_the_secret_before_handling_the_result() {
        let source = include_str!("provider_credential_store.rs");
        let write = source.find("let ok = unsafe { CredWriteW").unwrap();
        let delete = source[write..].find("pub fn delete").unwrap() + write;
        let native_write_tail = &source[write..delete];
        let zero = native_write_tail.find("secret.fill(0);").unwrap();
        let result_handling = native_write_tail.find("if ok == 0").unwrap();
        assert!(zero < result_handling);
    }

    #[test]
    fn native_reads_scrub_the_credential_blob_before_every_cred_free() {
        let source = include_str!("provider_credential_store.rs");
        let platform = source.split("#[cfg(target_os = \"windows\")]").nth(1).unwrap();
        let scrub_start = platform.find("unsafe fn scrub_credential_and_free").unwrap();
        let scrub = &platform[scrub_start..];

        assert!(platform.matches("scrub_credential_and_free(credential_ptr)").count() >= 2);
        assert!(scrub.contains("write_volatile"));
        assert!(scrub.find("write_volatile").unwrap() < scrub.find("CredFree").unwrap());
    }

    #[test]
    fn frontend_has_no_provider_secret_read_command() {
        let main_source = include_str!("main.rs");
        assert!(!main_source.contains("provider_read_api_key"));
    }
}
