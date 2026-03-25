; clipboard_sync.ahk
; 剪贴板同步到 VPS — Win + Shift + C 发送 / Win + Shift + V 从 VPS 拉取
; 支持文字和图片自动识别
#NoEnv
#SingleInstance Force
SendMode Input

API_URL := "http://150.158.110.168:5001/api/clipboard"
API_KEY := "fengshtindeed4789"

; ── Win + Shift + C : 推送剪贴板到 VPS ──────────────────
#+c::
    Clipboard := ""
    ClipboardAll := ""
    Send, ^c
    ClipWait, 2

    ; 先判断是否有图片（ClipboardAll 包含图片，Clipboard 只有文字）
    savedAll := ClipboardAll
    textContent := Clipboard

    if (textContent != "") {
        ; ── 文字推送 ──
        content := textContent
        content := StrReplace(content, "\", "\\")
        content := StrReplace(content, """", "\""")
        content := StrReplace(content, "`n", "\n")
        content := StrReplace(content, "`r", "")

        bodyFile := A_Temp . "\clip_push.json"
        body := "{""type"":""text"",""content"":""" . content . """,""source"":""pc""}"
        FileDelete, %bodyFile%
        FileAppend, %body%, %bodyFile%, UTF-8

        psCmd := "curl.exe -s --noproxy * -X POST '" . API_URL . "'"
               . " -H 'Content-Type: application/json'"
               . " -H 'X-API-Key: " . API_KEY . "'"
               . " -d '@" . bodyFile . "'"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psCmd%", , Hide
        FileDelete, %bodyFile%
        TrayTip, ✅ 文字已同步, 内容已推送到 VPS, 1

    } else if (savedAll != "") {
        ; ── 图片推送（用 PowerShell 读剪贴板图片并 base64 编码）──
        tmpImg  := A_Temp . "\clip_img.png"
        tmpJson := A_Temp . "\clip_push.json"

        ; 将剪贴板图片保存为 PNG 文件
        psImg := "$img = [System.Windows.Forms.Clipboard]::GetImage();"
               . "Add-Type -AssemblyName System.Windows.Forms;"
               . "Add-Type -AssemblyName System.Drawing;"
               . "$img = [System.Windows.Forms.Clipboard]::GetImage();"
               . "if ($img) { $img.Save('" . tmpImg . "', [System.Drawing.Imaging.ImageFormat]::Png) }"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psImg%", , Hide

        IfNotExist, %tmpImg%
        {
            TrayTip, 剪贴板同步, 无法读取图片, 1
            return
        }

        ; base64 编码 + 写 JSON
        psB64 := "$b = [Convert]::ToBase64String([IO.File]::ReadAllBytes('" . tmpImg . "'));"
               . "$json = '{""type"":""image"",""data"":""' + $b + '"",""ext"":""png"",""source"":""pc""}';"
               . "[IO.File]::WriteAllText('" . tmpJson . "', $json, [Text.Encoding]::UTF8)"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psB64%", , Hide
        FileDelete, %tmpImg%

        psCmd := "curl.exe -s --noproxy * -X POST '" . API_URL . "'"
               . " -H 'Content-Type: application/json'"
               . " -H 'X-API-Key: " . API_KEY . "'"
               . " -d '@" . tmpJson . "'"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psCmd%", , Hide
        FileDelete, %tmpJson%
        TrayTip, 🖼️ 图片已同步, 图片已推送到 VPS, 1

    } else {
        TrayTip, 剪贴板同步, 剪贴板为空，跳过, 1
    }
return

; ── Win + Shift + V : 从 VPS 拉取到本机剪贴板 ────────────
#+v::
    tmpJson := A_Temp . "\clip_pull.json"
    psGet := "Invoke-RestMethod -Uri '" . API_URL . "' -Headers @{'X-API-Key'='" . API_KEY . "'}"
           . " | ConvertTo-Json -Compress | Out-File -FilePath '" . tmpJson . "' -Encoding utf8 -NoNewline"
    RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psGet%", , Hide

    FileRead, raw, %tmpJson%
    FileDelete, %tmpJson%

    ; 判断类型
    RegExMatch(raw, """type""\s*:\s*""([^""]+)""", mType)
    clipType := mType1

    if (clipType = "image") {
        ; ── 图片拉取：base64 解码后设置到剪贴板 ──
        tmpImg := A_Temp . "\clip_pull.png"
        RegExMatch(raw, """data""\s*:\s*""([^""]+)""", mData)
        b64 := mData1

        psImg := "$b = '" . b64 . "';"
               . "[IO.File]::WriteAllBytes('" . tmpImg . "', [Convert]::FromBase64String($b));"
               . "Add-Type -AssemblyName System.Windows.Forms;"
               . "Add-Type -AssemblyName System.Drawing;"
               . "$img = [System.Drawing.Image]::FromFile('" . tmpImg . "');"
               . "[System.Windows.Forms.Clipboard]::SetImage($img);"
               . "$img.Dispose()"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psImg%", , Hide
        FileDelete, %tmpImg%

        if (ClipboardAll != "") {
            TrayTip, 🖼️ 图片已拉取, 图片已复制到剪贴板, 1
            Send, ^v
        } else {
            TrayTip, 剪贴板同步, 图片设置失败, 1
        }

    } else {
        ; ── 文字拉取 ──
        psText := "$r = Invoke-RestMethod -Uri '" . API_URL . "' -Headers @{'X-API-Key'='" . API_KEY . "'};"
                . "$r.content | Out-File -FilePath '" . A_Temp . "\clip_text.txt' -Encoding utf8 -NoNewline"
        tmpText := A_Temp . "\clip_text.txt"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psText%", , Hide
        FileRead, content, %tmpText%
        FileDelete, %tmpText%
        content := RTrim(content, "`r`n")

        if (content = "") {
            TrayTip, 剪贴板同步, VPS 上暂无内容, 1
            return
        }
        Clipboard := content
        ClipWait, 2
        TrayTip, 📋 文字已拉取, 内容已复制到本机剪贴板, 1
        Send, ^v
    }
return
