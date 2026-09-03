#[cfg(target_os = "windows")]
use std::{mem::size_of, thread, time::Duration};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LWIN,
};

#[cfg(target_os = "windows")]
fn keyboard_input(key: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn start_windows_voice_typing() -> Result<(), String> {
    // Give the webview time to return focus from the microphone button to its input.
    thread::sleep(Duration::from_millis(90));

    let inputs = [
        keyboard_input(VK_LWIN, 0),
        keyboard_input(0x48, 0),
        keyboard_input(0x48, KEYEVENTF_KEYUP),
        keyboard_input(VK_LWIN, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };

    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows 语音输入快捷键发送失败，请手动按 Win + H".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn start_windows_voice_typing() -> Result<(), String> {
    Err("系统语音输入仅支持 Windows 桌面版".to_string())
}
