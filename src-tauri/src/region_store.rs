const REGION_TARGET: &str = "com.focusai.taskmanager/minimax-region";

#[cfg(test)]
pub(crate) fn legacy_minimax_region_target() -> &'static str {
    REGION_TARGET
}

pub fn validate(region: &str) -> Result<&str, String> {
    match region {
        "cn" | "global" => Ok(region),
        _ => Err("MiniMax 服务区域必须是 cn 或 global".to_string()),
    }
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

    use super::{validate, REGION_TARGET};

    pub fn read() -> Result<Option<String>, String> {
        let target = wide(REGION_TARGET);
        let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe {
            CredReadW(
                target.as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut credential_ptr,
            )
        };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!("读取 MiniMax 服务区域失败（Windows 错误 {error}）"));
        }
        if credential_ptr.is_null() {
            return Err("Windows 凭据返回了空的 MiniMax 服务区域".to_string());
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
        unsafe { CredFree(credential_ptr.cast::<c_void>()) };
        if blob.is_empty() {
            return Ok(None);
        }
        let region = String::from_utf8(blob)
            .map_err(|_| "保存的 MiniMax 服务区域已损坏".to_string())?;
        validate(&region)?;
        Ok(Some(region))
    }

    pub fn save(region: &str) -> Result<(), String> {
        validate(region)?;
        let mut target = wide(REGION_TARGET);
        let mut username = wide("MiniMax Region");
        let mut blob = region.as_bytes().to_vec();
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = blob.len() as u32;
        credential.CredentialBlob = blob.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_mut_ptr();
        let ok = unsafe { CredWriteW(&credential, 0) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            return Err(format!("保存 MiniMax 服务区域失败（Windows 错误 {error}）"));
        }
        Ok(())
    }

    pub fn delete() -> Result<(), String> {
        let target = wide(REGION_TARGET);
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error != ERROR_NOT_FOUND {
                return Err(format!("删除 MiniMax 服务区域失败（Windows 错误 {error}）"));
            }
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn read() -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn save(_region: &str) -> Result<(), String> {
        Err("当前系统不支持 Windows 凭据管理器".to_string())
    }

    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}

pub use platform::{delete, read, save};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_explicit_official_regions() {
        assert_eq!(validate("cn").unwrap(), "cn");
        assert_eq!(validate("global").unwrap(), "global");
        assert!(validate("auto").is_err());
        assert!(validate("https://example.com").is_err());
    }

    #[test]
    fn region_target_is_namespaced_to_the_desktop_app() {
        assert_eq!(REGION_TARGET, "com.focusai.taskmanager/minimax-region");
    }
}
