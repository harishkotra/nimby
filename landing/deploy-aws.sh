#!/usr/bin/env bash
set -euo pipefail

for tool in aws curl node zip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

landing_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region || true)}}"
region="${region:-us-east-1}"
app_name=nimby-landing
branch="${NIMBY_AMPLIFY_BRANCH:-production}"
app_id="${NIMBY_AMPLIFY_APP_ID:-}"
stage=PRODUCTION

aws_cli() {
  aws --region "$region" --no-cli-pager "$@"
}

work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
archive="$work_dir/nimby-landing.zip"
site_dir="$work_dir/site"
case "$branch" in
  production) ;;
  demo)
    stage=DEVELOPMENT
    app_id="${app_id:-d3ulvfvvudr0cr}"
    ;;
  *) printf 'Set NIMBY_AMPLIFY_BRANCH to production or demo.\n' >&2; exit 1 ;;
esac
aws_cli sts get-caller-identity >/dev/null

search_stack="${NIMBY_PRODUCT_SEARCH_STACK:-nimby-product-search}"
search_url="${NIMBY_HOSTED_PRODUCT_SEARCH_URL:-}"
if [[ "${NIMBY_DEPLOY_PRODUCT_SEARCH:-0}" == 1 ]]; then
  search_url=$(AWS_REGION="$region" bash "$landing_dir/../server/deploy-product-search.sh")
  if [[ -z "$search_url" || "$search_url" == None ]]; then
    printf 'Retailer search stack did not return a ProductSearchUrl.\n' >&2
    exit 1
  fi
elif [[ -z "$search_url" ]]; then
  stack_error="$work_dir/search-stack-error"
  if ! search_url=$(aws_cli cloudformation describe-stacks --stack-name "$search_stack" \
    --query 'Stacks[0].Outputs[?OutputKey==`ProductSearchUrl`].OutputValue | [0]' --output text 2>"$stack_error"); then
    if [[ $(<"$stack_error") != *ValidationError*'does not exist'* ]]; then
      cat "$stack_error" >&2
      exit 1
    fi
    search_url=''
  fi
  [[ "$search_url" != None ]] || search_url=''
fi

NIMBY_HOSTED_PRODUCT_SEARCH_URL="$search_url" node "$landing_dir/build-demo.mjs" "$site_dir"
if [[ -n "$search_url" ]]; then
  response="$work_dir/search-probe.json"
  code=$(curl -q --silent --show-error --max-time 20 --header 'Content-Type: application/json' \
    --data '{}' --output "$response" --write-out '%{http_code}' "$search_url")
  if [[ "$code" != 400 ]] || ! node -e 'const body = JSON.parse(require("node:fs").readFileSync(process.argv[1])); process.exitCode = body.error === "Enter a product name or model." ? 0 : 1' "$response"; then
    printf 'Retailer search endpoint did not recognize a Nimby JSON request.\n' >&2
    exit 1
  fi
else
  printf 'No retailer search stack found. This build will use Google Shopping.\n' >&2
fi
(
  cd "$site_dir"
  zip -qr "$archive" index.html style.css main.js waitlist.js product-search.json assets -x '*/.*'
)

if [[ -z "$app_id" ]]; then
  app_ids=$(aws_cli amplify list-apps --query "apps[?name=='$app_name'].appId" --output json)
  app_id=$(node -e '
    const ids = JSON.parse(process.argv[1]);
    if (ids.length > 1) {
      console.error("Multiple apps are named nimby-landing. Set NIMBY_AMPLIFY_APP_ID to the intended app ID.");
      process.exit(1);
    }
    console.log(ids[0] ?? "");
  ' "$app_ids")
fi

if [[ -z "$app_id" ]]; then
  app_id=$(aws_cli amplify create-app --name "$app_name" --platform WEB --query 'app.appId' --output text)
fi

app=$(aws_cli amplify get-app --app-id "$app_id" --query "app.[platform,repository || 'None',defaultDomain]" --output text)
IFS=$'\t' read -r platform repository domain <<< "$app"
if [[ "$platform" != WEB || ( -n "$repository" && "$repository" != None ) || -z "$domain" || "$domain" == None ]]; then
  printf 'Amplify app %s must be a manually deployed static WEB app.\n' "$app_id" >&2
  exit 1
fi

existing_branch=$(aws_cli amplify list-branches --app-id "$app_id" --query "branches[?branchName=='$branch'].branchName" --output text)
if [[ "$existing_branch" != "$branch" ]]; then
  aws_cli amplify create-branch --app-id "$app_id" --branch-name "$branch" --stage "$stage" --no-enable-auto-build >/dev/null
fi

deployment=$(aws_cli amplify create-deployment --app-id "$app_id" --branch-name "$branch" --query '[jobId,zipUploadUrl]' --output text)
IFS=$'\t' read -r job_id upload_url <<< "$deployment"
if [[ ! "$job_id" =~ ^[0-9]+$ || "$upload_url" != https://* ]]; then
  printf 'Amplify did not return an upload URL and deployment job ID.\n' >&2
  exit 1
fi

printf 'url = "%s"\n' "$upload_url" |
  curl -q --config - --fail --silent --show-error --upload-file "$archive" --max-time 120 --output /dev/null
aws_cli amplify start-deployment --app-id "$app_id" --branch-name "$branch" --job-id "$job_id" >/dev/null

site_url="https://$branch.$domain"
printf 'Amplify job %s started for %s in %s.\n' "$job_id" "$app_id" "$region"
for ((attempt = 0; attempt < 72; attempt++)); do
  status=$(aws_cli amplify get-job --app-id "$app_id" --branch-name "$branch" --job-id "$job_id" --query 'job.summary.status' --output text)
  case "$status" in
    SUCCEED)
      curl --fail --silent --show-error --retry 4 --retry-all-errors --max-time 20 "$site_url/" --output "$work_dir/published.html"
      if ! cmp -s "$site_dir/index.html" "$work_dir/published.html"; then
        printf 'Deploy succeeded, but %s has not returned this build yet.\n' "$site_url" >&2
        exit 1
      fi
      curl --fail --silent --show-error --retry 4 --retry-all-errors --max-time 20 \
        "$site_url/product-search.json" --output "$work_dir/published-search.json"
      if ! cmp -s "$site_dir/product-search.json" "$work_dir/published-search.json"; then
        printf 'Deploy succeeded, but %s has not returned the new retailer configuration yet.\n' "$site_url" >&2
        exit 1
      fi
      printf 'Published and verified %s\n' "$site_url"
      exit 0
      ;;
    FAILED|CANCELLED)
      printf 'Amplify deployment %s ended with status %s.\n' "$job_id" "$status" >&2
      exit 1
      ;;
  esac
  sleep 10
done

printf 'Amplify deployment %s is still running for %s.\n' "$job_id" "$site_url" >&2
exit 1
