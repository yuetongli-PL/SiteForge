$utf8 = [System.Text.UTF8Encoding]::new()
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:NODE_NO_WARNINGS = $env:NODE_NO_WARNINGS

Write-Host 'Browser-Wiki-Skill console initialized for UTF-8.'
