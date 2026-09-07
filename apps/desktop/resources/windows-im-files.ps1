$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$inputReader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
$outputWriter = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), [Text.UTF8Encoding]::new($false))
$outputWriter.AutoFlush = $true
$inputLine = $inputReader.ReadLine()
$request = $inputLine | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'windows-im-files.cs')
$broker = $null
try {
  $broker = [ArtemisImFiles]::new($request.workspace, [string[]]$request.scope.readPaths, [string[]]$request.scope.writePaths, [string[]]$request.scope.filePaths, $request.protection)
  switch ($request.action) {
    'read' { $result = @{ data = $broker.ReadFile($request.path) } }
    'list' { $result = @{ entries = @($broker.List($request.path)) } }
    'snapshot' { $result = @{ entries = @($broker.Snapshot()) } }
    'apply' {
      $changes = @($request.changes | ForEach-Object {
        $change = [ArtemisImFiles+Change]::new()
        $change.path = $_.path
        $change.directory = $_.directory
        $change.delete = $_.delete
        if ($null -ne $_.expected) { $change.expected = $_.expected }
        if ($null -ne $_.data) { $change.data = $_.data }
        $change
      })
      $commit = $broker.Prepare([ArtemisImFiles+Change[]]$changes)
      $outputWriter.WriteLine('{"ready":true}')
      if ($inputReader.ReadLine() -ne 'commit') { throw 'IM authorization was cancelled.' }
      $commit.Invoke()
      $result = @{ applied = $true }
    }
    default { throw 'Unknown native IM file operation.' }
  }
  $outputWriter.WriteLine(($result | ConvertTo-Json -Depth 8 -Compress))
} catch {
  # Never include request content or PowerShell's source-line excerpt in errors.
  [Console]::Error.WriteLine('Native IM file operation refused: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $broker) { $broker.Dispose() }
  $outputWriter.Dispose()
  $inputReader.Dispose()
}
