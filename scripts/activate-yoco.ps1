$ErrorActionPreference = "Stop"

$projectRef = "vfifwtqbsdaxsikjpvku"
$siteUrl = "https://komponation.co.za"
$webhookUrl = "https://$projectRef.supabase.co/functions/v1/yoco-webhook"
$keyPointer = [IntPtr]::Zero
$yocoKey = $null
$webhookSecret = $null

try {
  $secureKey = Read-Host "Paste the Yoco LIVE SECRET key (input is hidden)" -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $yocoKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)

  if ($yocoKey -notmatch "^sk_live_") {
    throw "That is not a Yoco live secret key (expected sk_live_...). Nothing was changed."
  }

  Write-Host "Testing the live key with a R2.00 unpaid checkout..."
  $testId = "kompo-setup-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  $checkoutBody = @{
    amount = 200
    currency = "ZAR"
    successUrl = "$siteUrl/payment-success?provider=yoco-setup"
    cancelUrl = "$siteUrl/cart?payment=cancelled"
    failureUrl = "$siteUrl/cart?payment=failed"
    clientReferenceId = $testId
    externalId = $testId
    metadata = @{ purpose = "gateway-setup-test" }
  } | ConvertTo-Json -Depth 4

  $checkout = Invoke-RestMethod `
    -Method Post `
    -Uri "https://payments.yoco.com/api/checkouts" `
    -Headers @{
      Authorization = "Bearer $yocoKey"
      "Idempotency-Key" = $testId
      "Content-Type" = "application/json"
    } `
    -Body $checkoutBody

  if (-not $checkout.id -or -not $checkout.redirectUrl) {
    throw "Yoco accepted the request but did not return a checkout ID and redirect URL."
  }

  Write-Host "Live checkout API passed (unpaid checkout $($checkout.id))."
  Write-Host "Registering the signed production webhook..."

  $webhookBody = @{
    name = "Kompo Nation production payments"
    url = $webhookUrl
  } | ConvertTo-Json

  try {
    $webhook = Invoke-RestMethod `
      -Method Post `
      -Uri "https://payments.yoco.com/api/webhooks" `
      -Headers @{
        Authorization = "Bearer $yocoKey"
        "Content-Type" = "application/json"
      } `
      -Body $webhookBody
  } catch {
    throw "Yoco could not register the webhook. If this URL is already registered, delete the old Yoco webhook and run this script again so a new one-time signing secret can be saved. $($_.Exception.Message)"
  }

  $webhookSecret = $webhook.secret
  if (-not $webhookSecret -or $webhookSecret -notmatch "^whsec_") {
    throw "Yoco did not return the expected one-time webhook signing secret. Nothing was activated."
  }

  Write-Host "Saving encrypted Supabase secrets and activating Yoco..."
  & npx supabase secrets set `
    --project-ref $projectRef `
    "YOCO_SECRET_KEY=$yocoKey" `
    "YOCO_WEBHOOK_SECRET=$webhookSecret" `
    "PAYMENT_PROVIDER=yoco" `
    "PAYMENT_ALLOW_PLATFORM_COLLECTION=true"

  if ($LASTEXITCODE -ne 0) {
    throw "Supabase rejected the secret update. Yoco was not activated."
  }

  Write-Host ""
  Write-Host "YOCO_ACTIVATED_SUCCESSFULLY" -ForegroundColor Green
  Write-Host "Return to Codex and say: done"
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }

  $yocoKey = $null
  $webhookSecret = $null
}
