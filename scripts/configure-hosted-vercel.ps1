[CmdletBinding()]
param(
  [string]$ProjectScope = 'ryohryps-projects',
  [string]$Repository = 'ryohryp/---The-Bottom-of-Thirst',
  [string]$Ref = 'main',
  [string]$ProductionUrl = 'https://visual-director-beta.vercel.app',
  [switch]$UseGitHubCliToken,
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
$secretName = 'VISUAL_DIRECTOR_GITHUB_TOKEN'

if ($Repository -ne 'ryohryp/---The-Bottom-of-Thirst') {
  throw 'This setup script is intentionally scoped to ryohryp/---The-Bottom-of-Thirst.'
}
if ($Ref -notmatch '^[A-Za-z0-9._/-]+$') {
  throw 'Ref contains unsupported characters.'
}
if ($ProductionUrl -notmatch '^https://[^/]+/?$') {
  throw 'ProductionUrl must be an HTTPS origin without a path.'
}

$githubToken = $env:VISUAL_DIRECTOR_GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($githubToken) -and $UseGitHubCliToken) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI was not found. Install it or provide VISUAL_DIRECTOR_GITHUB_TOKEN.'
  }
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Authenticate with a repository-scoped read-only credential first.'
  }
  $githubToken = (& gh auth token 2>$null | Out-String).Trim()
}
if ([string]::IsNullOrWhiteSpace($githubToken)) {
  throw 'Set VISUAL_DIRECTOR_GITHUB_TOKEN or explicitly pass -UseGitHubCliToken. The value is read from memory and never printed.'
}

$repositoryParts = $Repository.Split('/', 2)
$owner = $repositoryParts[0]
$repo = $repositoryParts[1]
$encodedRef = [Uri]::EscapeDataString($Ref)
$canonUri = "https://api.github.com/repos/$owner/$repo/contents/docs/visual/CHARACTER_VISUAL_CANON.md?ref=$encodedRef"
$githubHeaders = @{
  Accept = 'application/vnd.github+json'
  Authorization = "Bearer $githubToken"
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'visual-director-hosted-setup'
}
try {
  $canonResponse = Invoke-WebRequest -Uri $canonUri -Headers $githubHeaders -UseBasicParsing
  if ($canonResponse.StatusCode -ne 200) {
    throw "HTTP $($canonResponse.StatusCode)"
  }
} catch {
  throw 'The supplied GitHub credential could not read the target repository Canon file. No Vercel change was made.'
}

$vercel = Get-Command vercel -CommandType Application -ErrorAction SilentlyContinue
$useNpx = $null -eq $vercel
if ($useNpx -and -not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  throw 'Vercel CLI and npx.cmd were not found.'
}

function Invoke-Vercel {
  param([string[]]$Arguments)

  if ($script:useNpx) {
    $output = @(& npx.cmd --yes vercel@latest @Arguments 2>&1)
  } else {
    $output = @(& $script:vercel.Source @Arguments 2>&1)
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel CLI command failed: vercel $($Arguments -join ' ')"
  }
  return $output
}

function Invoke-VercelWithInput {
  param(
    [string]$InputValue,
    [string[]]$Arguments
  )

  if ($script:useNpx) {
    $output = $InputValue | & npx.cmd --yes vercel@latest @Arguments 2>&1
  } else {
    $output = $InputValue | & $script:vercel.Source @Arguments 2>&1
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel CLI command failed: vercel $($Arguments -join ' ')"
  }
  return $output
}

Write-Output 'Linking the visual-director Vercel project (CLI output suppressed).'
$null = Invoke-Vercel @('link', '--yes', '--project', 'visual-director', '--scope', $ProjectScope)

$null = Invoke-VercelWithInput -InputValue $githubToken -Arguments @('env', 'add', $secretName, 'production', '--sensitive', '--force')

Write-Output "Configured $secretName in Vercel production (sensitive; value redacted)."
if (-not $SkipDeploy) {
  $null = Invoke-Vercel @('redeploy', $ProductionUrl)
  Write-Output 'Redeployed the production deployment once after secret configuration.'
} else {
  Write-Output 'Skipped production redeploy (-SkipDeploy).'
}

Write-Output 'Next: npm.cmd run verify:hosted -- https://visual-director-beta.vercel.app/mcp'
