param([int]$Port = 9222)

$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
$target = $targets | Where-Object { $_.url -eq "http://tauri.localhost/" } | Select-Object -First 1
if (-not $target) {
  throw "Main WebView target was not found."
}

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync(
  [Uri]$target.webSocketDebuggerUrl,
  [Threading.CancellationToken]::None
).GetAwaiter().GetResult() | Out-Null

$script:nextId = 0
$script:events = [System.Collections.Generic.List[object]]::new()

function Send-Cdp {
  param([string]$Method, [hashtable]$Params = @{})
  $script:nextId += 1
  $json = @{ id = $script:nextId; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 20
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $socket.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null
  return $script:nextId
}

function Receive-Cdp {
  $stream = [IO.MemoryStream]::new()
  do {
    $buffer = [byte[]]::new(65536)
    $segment = [ArraySegment[byte]]::new($buffer)
    $result = $socket.ReceiveAsync(
      $segment,
      [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()
    $stream.Write($buffer, 0, $result.Count)
  } until ($result.EndOfMessage)

  $text = [Text.Encoding]::UTF8.GetString($stream.ToArray())
  $stream.Dispose()
  return $text | ConvertFrom-Json -Depth 30
}

function Wait-CdpResponse {
  param([int]$Id)
  while ($true) {
    $message = Receive-Cdp
    if ($message.id -eq $Id) {
      return $message
    }
    $script:events.Add($message)
  }
}

foreach ($domain in @("Runtime.enable", "Log.enable", "Page.enable")) {
  $id = Send-Cdp $domain
  Wait-CdpResponse $id | Out-Null
}

$reloadId = Send-Cdp "Page.reload" @{ ignoreCache = $true }
Wait-CdpResponse $reloadId | Out-Null
Start-Sleep -Seconds 2

$expression = @"
({
  readyState: document.readyState,
  rootHtml: document.getElementById('root')?.innerHTML ?? null,
  scripts: [...document.scripts].map(script => script.src),
  theme: document.documentElement.dataset.theme ?? null
})
"@
$evaluateId = Send-Cdp "Runtime.evaluate" @{
  expression = $expression
  returnByValue = $true
}
$state = Wait-CdpResponse $evaluateId

[pscustomobject]@{
  state = $state.result.result.value
  errors = @(
    $script:events |
      Where-Object { $_.method -in @("Runtime.exceptionThrown", "Log.entryAdded") } |
      ForEach-Object { $_.params }
  )
} | ConvertTo-Json -Depth 30

$socket.Dispose()
