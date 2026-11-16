# Clean-state evaluation run: fresh clone of a revision, new Docker volumes, every reported check.
# Usage (Windows PowerShell 5.1+, Docker Desktop running, host Node >= 24, ports 3100/5173/8180 free):
#   powershell -ExecutionPolicy Bypass -File evaluation\run-clean-evaluation.ps1 [-Revision cs5903-final-2026] [-SkipMutation] [-BrowserChannel msedge|chrome]
# Writes raw logs to evaluation\results\<yyyy-MM-dd>-clean\ in THIS checkout and removes the isolated
# stack and its volumes at the end. Nothing in your normal stack or volumes is touched, but stop
# your normal stack first (docker compose stop) because the ports are the same.
param(
  [string]$Revision = "HEAD",
  [string]$Repository = (git rev-parse --show-toplevel),
  [switch]$SkipMutation,
  [string]$BrowserChannel = $env:IAM_BROWSER_CHANNEL
)
$ErrorActionPreference = "Continue"
$date = Get-Date -Format "yyyy-MM-dd"
$out = Join-Path $Repository "evaluation\results\$date-clean"
New-Item -ItemType Directory -Force $out | Out-Null
$work = Join-Path $env:TEMP "iam-clean-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sha = (git -C $Repository rev-parse $Revision)
git clone --quiet $Repository $work
git -C $work checkout --quiet $sha
Push-Location $work
$env:COMPOSE_PROJECT_NAME = "iam-evalclean"
function Log($name, [scriptblock]$block) {
  $file = Join-Path $out $name
  "== $name $(Get-Date -Format o) revision $sha" | Out-File -Encoding utf8 $file
  & $block 2>&1 | Out-File -Encoding utf8 -Append $file
  "exit $LASTEXITCODE" | Out-File -Encoding utf8 -Append $file
  Write-Host "$name -> exit $LASTEXITCODE"
}
try {
  Log "01-up.log" { docker compose up -d --build --wait }
  Log "02-checks.log" {
    docker compose exec -T backend npm run typecheck; docker compose exec -T backend npm run build
    docker compose exec -T backend npm audit; node scripts/verify-client-config.mjs }
  $env:IAM_ALLOW_PASSWORD_GRANT_TESTS = "true"
  node scripts/configure-keycloak.mjs --enable-test-client | Out-Null
  Log "03-full-suite.log" { docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test }
  Log "04-e1-baseline-revocation.jsonl" { Get-Content evaluation/scripts/baseline-revocation.mjs | docker compose exec -T backend node --input-type=module - }
  node scripts/configure-keycloak.mjs | Out-Null
  Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS
  Log "05-latency.log" { Get-Content scripts/measure-latency.mjs | docker compose exec -T backend node --input-type=module - }
  npm --prefix backend ci --silent | Out-Null
  $env:KEYCLOAK_ADMIN_CLIENT_SECRET = "dev-provider-admin-secret"
  if ($BrowserChannel) { $env:IAM_BROWSER_CHANNEL = $BrowserChannel }
  Log "06-browser-proof.log" { node scripts/verify-pkce.mjs }
  if (-not $SkipMutation) { Log "07-mutation.log" { node scripts/verify-test-independence.mjs } }
} finally {
  docker compose down -v --remove-orphans 2>&1 | Out-Null
  Pop-Location
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  Remove-Item Env:COMPOSE_PROJECT_NAME -ErrorAction SilentlyContinue
}
Write-Host "Logs in $out"
