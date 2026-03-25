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
    Send, ^c
    ClipWait, 2

    ; 用 PowerShell 判断类型：bitmap > 文件路径 > 文字中含图片路径 > 文字
    tmpType := A_Temp . "\clip_type.txt"
    psCheck := "Add-Type -AssemblyName System.Windows.Forms;"
             . "Add-Type -AssemblyName System.Drawing;"
             . "$exts=@('.png','.jpg','.jpeg','.gif','.bmp','.webp');"
             . "$r='text';"
             . "if([System.Windows.Forms.Clipboard]::ContainsImage()){$r='image_bitmap'}"
             . "elseif([System.Windows.Forms.Clipboard]::ContainsFileDropList()){"
             . "  $f=[System.Windows.Forms.Clipboard]::GetFileDropList()[0];"
             . "  if($exts -contains [IO.Path]::GetExtension($f).ToLower()){$r='image_file:'+$f}}"
             . "else{"
             . "  $t=[System.Windows.Forms.Clipboard]::GetText().Trim();"
             . "  if($t -and (Test-Path $t) -and ($exts -contains [IO.Path]::GetExtension($t).ToLower())){$r='image_file:'+$t}};"
             . "$r | Out-File -FilePath '" . tmpType . "' -Encoding utf8 -NoNewline"
    RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psCheck%", , Hide
    FileRead, detectedType, %tmpType%
    FileDelete, %tmpType%
    detectedType := Trim(detectedType, "`r`n ")

    if (detectedType = "image_bitmap" or InStr(detectedType, "image_file:")) {
        ; ── 图片推送 ──
        tmpImg  := A_Temp . "\clip_img.png"
        tmpJson := A_Temp . "\clip_push.json"

        if (InStr(detectedType, "image_file:")) {
            ; QQ/文件管理器复制图片文件 → 直接从路径读
            srcFile := SubStr(detectedType, 12)
            psImg := "Add-Type -AssemblyName System.Drawing;"
                   . "$img = [System.Drawing.Image]::FromFile('" . srcFile . "');"
                   . "$img.Save('" . tmpImg . "', [System.Drawing.Imaging.ImageFormat]::Png);"
                   . "$img.Dispose()"
        } else {
            ; 截图/bitmap → 从剪贴板读
            psImg := "Add-Type -AssemblyName System.Windows.Forms;"
                   . "Add-Type -AssemblyName System.Drawing;"
                   . "$img = [System.Windows.Forms.Clipboard]::GetImage();"
                   . "if ($img) { $img.Save('" . tmpImg . "', [System.Drawing.Imaging.ImageFormat]::Png) }"
        }
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psImg%", , Hide

        IfNotExist, %tmpImg%
        {
            TrayTip, 剪贴板同步, 无法读取图片, 1
            return
        }

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
        ; ── 文字推送 ──
        content := Clipboard
        if (content = "") {
            TrayTip, 剪贴板同步, 剪贴板为空，跳过, 1
            return
        }
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
    }
return

; ── Win + Shift + V : 从 VPS 拉取到本机剪贴板 ────────────
#+v::
    tmpJson := A_Temp . "\clip_pull.json"
    psGet := "(Invoke-WebRequest -Uri '" . API_URL . "' -Headers @{'X-API-Key'='" . API_KEY . "'} -UseBasicParsing).Content"
           . " | Out-File -FilePath '" . tmpJson . "' -Encoding utf8 -NoNewline"
    RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psGet%", , Hide

    FileRead, raw, %tmpJson%
    FileDelete, %tmpJson%

    RegExMatch(raw, """type""\s*:\s*""([^""]+)""", mType)
    clipType := mType1

    if (clipType = "image") {
        ; ── 图片拉取 ──
        tmpImg := A_Temp . "\clip_pull.png"
        RegExMatch(raw, """data""\s*:\s*""([^""]+)""", mData)
        b64 := mData1

        psImg := "Add-Type -AssemblyName System.Windows.Forms;"
               . "Add-Type -AssemblyName System.Drawing;"
               . "$b = '" . b64 . "';"
               . "[IO.File]::WriteAllBytes('" . tmpImg . "', [Convert]::FromBase64String($b));"
               . "$img = [System.Drawing.Image]::FromFile('" . tmpImg . "');"
               . "[System.Windows.Forms.Clipboard]::SetImage($img);"
               . "$img.Dispose()"
        RunWait, PowerShell.exe -NoProfile -WindowStyle Hidden -Command "%psImg%", , Hide
        FileDelete, %tmpImg%
        TrayTip, 🖼️ 图片已拉取, 图片已复制到剪贴板，按 Ctrl+V 粘贴, 1

    } else {
        ; ── 文字拉取 ──
        tmpText := A_Temp . "\clip_text.txt"
        psText := "$r = Invoke-RestMethod -Uri '" . API_URL . "' -Headers @{'X-API-Key'='" . API_KEY . "'};"
                . "$r.content | Out-File -FilePath '" . tmpText . "' -Encoding utf8 -NoNewline"
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
