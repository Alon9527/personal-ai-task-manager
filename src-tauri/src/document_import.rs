use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::io::Read;
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: usize = 8 * 1024 * 1024;
const MAX_XML_BYTES: usize = 8 * 1024 * 1024;
const MAX_ROWS: usize = 500;
const MAX_COLUMNS: usize = 32;
const MAX_CELL_CHARS: usize = 2_000;
const MAX_TOTAL_CHARACTERS: usize = 200_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfficeImportRequest {
    file_name: String,
    data_base64: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeImportResult {
    kind: String,
    source_name: String,
    rows: Vec<Vec<String>>,
    warnings: Vec<String>,
}

#[tauri::command]
pub fn parse_office_document(request: OfficeImportRequest) -> Result<OfficeImportResult, String> {
    if request.data_base64.len() > MAX_ARCHIVE_BYTES * 2 {
        return Err("文件编码内容过大".to_string());
    }
    let bytes = STANDARD
        .decode(request.data_base64.as_bytes())
        .map_err(|_| "文件编码无效".to_string())?;
    parse_office_bytes(&request.file_name, &bytes)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    validate_feishu_url(&url)?;
    launch_url(url.trim())
}

fn parse_office_bytes(file_name: &str, bytes: &[u8]) -> Result<OfficeImportResult, String> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err("文件不能超过 8 MB".to_string());
    }
    let source_name = file_name.trim();
    if source_name.is_empty()
        || source_name.chars().count() > 255
        || source_name.chars().any(char::is_control)
        || source_name.contains('/')
        || source_name.contains('\\')
    {
        return Err("文件名无效".to_string());
    }
    let extension = source_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "docx" && extension != "xlsx" {
        return Err("仅支持 .docx 和 .xlsx 文件".to_string());
    }
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|_| "文件不是有效的 Office Open XML 文档".to_string())?;
    match extension.as_str() {
        "docx" => parse_docx(&mut archive, source_name),
        "xlsx" => parse_xlsx(&mut archive, source_name),
        _ => unreachable!(),
    }
}

fn validate_feishu_url(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 2_048 {
        return Err("飞书链接无效".to_string());
    }
    let url = url::Url::parse(value).map_err(|_| "飞书链接无效".to_string())?;
    if url.scheme() != "https" {
        return Err("飞书链接必须使用 HTTPS".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("链接中不能包含账号凭据".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed = ["feishu.cn", "larksuite.com"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    if !allowed {
        return Err("仅允许飞书或 Lark 域名".to_string());
    }
    Ok(())
}


fn parse_docx(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    source_name: &str,
) -> Result<OfficeImportResult, String> {
    let xml = read_zip_entry(archive, "word/document.xml", MAX_XML_BYTES)?
        .ok_or_else(|| "Word 文档缺少 document.xml".to_string())?;
    let paragraphs = xml_elements(&xml, "w:p");
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    for paragraph in paragraphs {
        let text = truncate_chars(text_nodes(paragraph.inner, "w:t").trim(), MAX_CELL_CHARS);
        if text.is_empty() {
            continue;
        }
        if rows.len() >= MAX_ROWS {
            warnings.push("文档内容超过 500 行，仅显示前 500 行".to_string());
            break;
        }
        rows.push(vec![text]);
    }
    if rows.is_empty() {
        return Err("Word 文档中没有可导入的文字段落".to_string());
    }
    Ok(OfficeImportResult {
        kind: "docx".to_string(),
        source_name: source_name.to_string(),
        rows,
        warnings,
    })
}

fn parse_xlsx(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    source_name: &str,
) -> Result<OfficeImportResult, String> {
    let shared_xml = read_zip_entry(archive, "xl/sharedStrings.xml", MAX_XML_BYTES)?;
    let shared_strings = shared_xml
        .as_deref()
        .map(|xml| {
            xml_elements(xml, "si")
                .into_iter()
                .map(|item| truncate_chars(&text_nodes(item.inner, "t"), MAX_CELL_CHARS))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut worksheet_names = Vec::new();
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| "Excel 工作表目录损坏".to_string())?;
        let name = file.name().to_string();
        if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
            worksheet_names.push(name);
        }
    }
    worksheet_names.sort();
    let worksheet_name = worksheet_names
        .first()
        .ok_or_else(|| "Excel 文件中没有可读取的工作表".to_string())?;
    let xml = read_zip_entry(archive, worksheet_name, MAX_XML_BYTES)?
        .ok_or_else(|| "Excel 工作表内容缺失".to_string())?;

    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut total_characters = 0usize;
    for row in xml_elements(&xml, "row") {
        if rows.len() >= MAX_ROWS {
            warnings.push("表格超过 500 行，仅显示前 500 行".to_string());
            break;
        }
        let mut values: Vec<String> = Vec::new();
        let mut sequential_column = 0usize;
        for cell in xml_elements(row.inner, "c") {
            let column = attribute_value(cell.opening, "r")
                .and_then(|reference| column_index(&reference))
                .unwrap_or(sequential_column);
            sequential_column = column.saturating_add(1);
            if column >= MAX_COLUMNS {
                if !warnings.iter().any(|warning| warning.contains("32 列")) {
                    warnings.push("表格超过 32 列，超出部分已忽略".to_string());
                }
                continue;
            }
            let cell_type = attribute_value(cell.opening, "t").unwrap_or_default();
            let raw = if cell_type == "inlineStr" {
                text_nodes(cell.inner, "t")
            } else {
                xml_elements(cell.inner, "v")
                    .first()
                    .map(|value| decode_xml_text(value.inner.trim()))
                    .unwrap_or_default()
            };
            let value = if cell_type == "s" {
                raw.parse::<usize>()
                    .ok()
                    .and_then(|index| shared_strings.get(index))
                    .cloned()
                    .unwrap_or_default()
            } else if cell_type == "b" {
                match raw.as_str() {
                    "1" => "TRUE".to_string(),
                    "0" => "FALSE".to_string(),
                    _ => raw,
                }
            } else {
                raw
            };
            let value = truncate_chars(value.trim(), MAX_CELL_CHARS);
            total_characters = total_characters.saturating_add(value.chars().count());
            if total_characters > MAX_TOTAL_CHARACTERS {
                return Err("表格文字内容过多，请拆分后再导入".to_string());
            }
            if values.len() <= column {
                values.resize(column + 1, String::new());
            }
            values[column] = value;
        }
        while values.last().is_some_and(String::is_empty) {
            values.pop();
        }
        if values.iter().any(|value| !value.is_empty()) {
            rows.push(values);
        }
    }
    if rows.is_empty() {
        return Err("Excel 工作表中没有可导入的数据".to_string());
    }
    Ok(OfficeImportResult {
        kind: "xlsx".to_string(),
        source_name: source_name.to_string(),
        rows,
        warnings,
    })
}

fn read_zip_entry(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    name: &str,
    limit: usize,
) -> Result<Option<String>, String> {
    let mut file = match archive.by_name(name) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err("Office 压缩包目录损坏".to_string()),
    };
    if file.size() > limit as u64 {
        return Err("Office 文档内部 XML 过大".to_string());
    }
    let mut bytes = Vec::with_capacity(file.size() as usize);
    file.by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取 Office 文档内容".to_string())?;
    if bytes.len() > limit {
        return Err("Office 文档内部 XML 过大".to_string());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "Office 文档文字编码无效".to_string())
}

#[derive(Clone, Copy)]
struct XmlElement<'a> {
    opening: &'a str,
    inner: &'a str,
}

fn xml_elements<'a>(input: &'a str, tag: &str) -> Vec<XmlElement<'a>> {
    let opening_marker = format!("<{tag}");
    let closing_marker = format!("</{tag}>");
    let mut cursor = 0usize;
    let mut elements = Vec::new();
    while let Some(relative) = input[cursor..].find(&opening_marker) {
        let start = cursor + relative;
        let boundary = input.as_bytes().get(start + opening_marker.len()).copied();
        if !matches!(boundary, Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n')) {
            cursor = start + opening_marker.len();
            continue;
        }
        let Some(opening_end_relative) = input[start..].find('>') else {
            break;
        };
        let opening_end = start + opening_end_relative + 1;
        let Some(closing_relative) = input[opening_end..].find(&closing_marker) else {
            break;
        };
        let closing_start = opening_end + closing_relative;
        elements.push(XmlElement {
            opening: &input[start..opening_end],
            inner: &input[opening_end..closing_start],
        });
        cursor = closing_start + closing_marker.len();
    }
    elements
}

fn text_nodes(input: &str, tag: &str) -> String {
    xml_elements(input, tag)
        .into_iter()
        .map(|element| decode_xml_text(element.inner))
        .collect::<String>()
}

fn attribute_value(opening: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let marker = format!("{name}={quote}");
        if let Some(start) = opening.find(&marker) {
            let value_start = start + marker.len();
            if let Some(end) = opening[value_start..].find(quote) {
                return Some(decode_xml_text(&opening[value_start..value_start + end]));
            }
        }
    }
    None
}

fn column_index(reference: &str) -> Option<usize> {
    let mut value = 0usize;
    let mut saw_letter = false;
    for byte in reference.bytes() {
        if !byte.is_ascii_alphabetic() {
            break;
        }
        saw_letter = true;
        value = value
            .checked_mul(26)?
            .checked_add((byte.to_ascii_uppercase() - b'A' + 1) as usize)?;
    }
    saw_letter.then(|| value.saturating_sub(1))
}

fn decode_xml_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(position) = remaining.find('&') {
        output.push_str(&remaining[..position]);
        let entity_start = position + 1;
        let Some(end_relative) = remaining[entity_start..].find(';') else {
            output.push_str(&remaining[position..]);
            return output;
        };
        let entity_end = entity_start + end_relative;
        let entity = &remaining[entity_start..entity_end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.starts_with("#x") => u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse::<u32>()
                .ok()
                .and_then(char::from_u32),
            _ => None,
        };
        if let Some(character) = decoded {
            output.push(character);
        } else {
            output.push_str(&remaining[position..=entity_end]);
        }
        remaining = &remaining[entity_end + 1..];
    }
    output.push_str(remaining);
    output
}

fn truncate_chars(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[cfg(windows)]
fn launch_url(url: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::{ffi::OsStr, ptr};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = OsStr::new(url).encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("系统无法打开飞书链接".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn launch_url(_url: &str) -> Result<(), String> {
    Err("当前系统暂不支持打开外部链接".to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn office_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        for (name, content) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start fixture entry");
            writer.write_all(content.as_bytes()).expect("write fixture");
        }
        writer.finish().expect("finish fixture").into_inner()
    }

    #[test]
    fn parses_docx_paragraphs_without_touching_the_filesystem() {
        let bytes = office_zip(&[(
            "word/document.xml",
            r#"<w:document xmlns:w="urn:test"><w:body>
                <w:p><w:r><w:t>跟进报价</w:t></w:r></w:p>
                <w:p><w:r><w:t>确认 &amp; 交期</w:t></w:r></w:p>
            </w:body></w:document>"#,
        )]);

        let result = parse_office_bytes("会议纪要.docx", &bytes).expect("parse docx");

        assert_eq!(result.kind, "docx");
        assert_eq!(result.source_name, "会议纪要.docx");
        assert_eq!(
            result.rows,
            vec![vec!["跟进报价".to_string()], vec!["确认 & 交期".to_string()]]
        );
    }

    #[test]
    fn parses_xlsx_shared_strings_and_preserves_blank_columns() {
        let bytes = office_zip(&[
            (
                "xl/sharedStrings.xml",
                r#"<sst><si><t>任务</t></si><si><t>项目</t></si><si><t>确认包装</t></si><si><t>新品上市</t></si></sst>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData>
                    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
                    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
                </sheetData></worksheet>"#,
            ),
        ]);

        let result = parse_office_bytes("计划.xlsx", &bytes).expect("parse xlsx");

        assert_eq!(result.kind, "xlsx");
        assert_eq!(
            result.rows,
            vec![
                vec!["任务".to_string(), "项目".to_string()],
                vec!["确认包装".to_string(), "新品上市".to_string()],
            ]
        );
    }

    #[test]
    fn rejects_unsupported_files_oversize_payloads_and_lookalike_links() {
        assert!(parse_office_bytes("notes.txt", b"text")
            .unwrap_err()
            .contains("docx"));
        assert!(parse_office_bytes("large.docx", &vec![0; MAX_ARCHIVE_BYTES + 1])
            .unwrap_err()
            .contains("8 MB"));
        assert!(validate_feishu_url("https://acme.feishu.cn/base/abc").is_ok());
        assert!(validate_feishu_url("https://feishu.cn.evil.example/base/abc").is_err());
    }
}
