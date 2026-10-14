param([string]$Root, [int]$Port = 8765)
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Root <carpeta del proyecto> -Port 8770
# Servidor estático mínimo para previsualizar la app (solo localhost).
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Sirviendo $Root en http://localhost:$Port"
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.json'='application/json'; '.png'='image/png'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
  $file = Join-Path $Root $path
  $full = [IO.Path]::GetFullPath($file)
  if ($full.StartsWith([IO.Path]::GetFullPath($Root)) -and (Test-Path $full -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full)
    $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Output "200 /$path"
  } else {
    $ctx.Response.StatusCode = 404
    Write-Output "404 /$path"
  }
  $ctx.Response.Close()
}
