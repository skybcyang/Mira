param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
if ($env:MIRA_WINDOWS_CERT_THUMBPRINT -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Missing signing certificate thumbprint' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$env:MIRA_WINDOWS_CERT_THUMBPRINT"
if (-not $certificate.HasPrivateKey) { throw 'Signing certificate has no private key' }
$files = @(Get-ChildItem -LiteralPath $Directory -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' })
if ($files.Count -eq 0) { throw 'No Windows binaries to sign' }
foreach ($file in $files) {
  $result = Set-AuthenticodeSignature -LiteralPath $file.FullName -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  if ($result.Status -ne 'Valid') { throw "Signing failed: $($file.Name)" }
  $verified = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($verified.Status -ne 'Valid' -or $verified.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or $null -eq $verified.TimeStamperCertificate) { throw "Signature verification failed: $($file.Name)" }
}
