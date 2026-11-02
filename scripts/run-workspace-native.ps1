param([ValidateSet('small','synthetic','archive','archive-fresh','workflow')][string]$Case='small',[ValidateSet('light','dark')][string]$Theme='light',[int]$TimeoutSeconds=900)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskProfile=Join-Path $taskRoot ('.test-profile-workspace-'+$Case)
$taskData=Join-Path $taskRoot ('build/workspace-'+$Case+'-data')
$taskMarker=Get-Content -LiteralPath (Join-Path $taskProfile '.smart-tags-smoke-profile.json') -Raw | ConvertFrom-Json
if($taskMarker.root -ne $taskRoot -or $taskMarker.data -ne $taskData){throw 'Unexpected isolated test marker'}
$taskActive=@(Get-CimInstance Win32_Process -Filter "Name = 'zotero.exe'" | Where-Object {$_.CommandLine -like ('*'+$taskProfile+'*')})
if($taskActive.Count){throw 'The isolated profile is already active'}
$taskReport=Join-Path $taskRoot ('build/native-workspace-'+$Case+'-'+$Theme+'-report.json')
$taskStart=(Get-Date).ToUniversalTime()
$taskProcess=Start-Process -FilePath 'C:/Program Files/Zotero/zotero.exe' -ArgumentList @('-no-remote','-profile',$taskProfile,'-datadir',$taskData,'-purgecaches','-ZoteroDebugText') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot ('build/native-workspace-'+$Case+'.stdout.log')) -RedirectStandardError (Join-Path $taskRoot ('build/native-workspace-'+$Case+'.stderr.log'))
try{
  $taskResult=$null
  for($taskPoll=0;$taskPoll -lt $TimeoutSeconds*2;$taskPoll++){
    if(Test-Path -LiteralPath $taskReport){
      try{$taskCandidate=Get-Content -LiteralPath $taskReport -Raw | ConvertFrom-Json}catch{$taskCandidate=$null}
      if($taskCandidate -and $taskCandidate.status -in @('passed','failed') -and ([datetime]$taskCandidate.startedAt).ToUniversalTime() -ge $taskStart.AddSeconds(-1)){$taskResult=$taskCandidate;break}
    }
    Start-Sleep -Milliseconds 500
  }
  if(-not $taskResult){throw 'Native Workspace checks timed out'}
  $taskResult | ConvertTo-Json -Depth 8 -Compress
  if($taskResult.status -ne 'passed'){throw 'Native Workspace checks failed'}
}finally{
  $taskOwned=@(Get-CimInstance Win32_Process -Filter "Name = 'zotero.exe'" | Where-Object {$_.CommandLine -like ('*'+$taskProfile+'*') -and ($_.ProcessId -eq $taskProcess.Id -or $_.ParentProcessId -eq $taskProcess.Id)})
  foreach($taskChild in $taskOwned){Stop-Process -Id $taskChild.ProcessId;Wait-Process -Id $taskChild.ProcessId -Timeout 10 -ErrorAction SilentlyContinue}
}
