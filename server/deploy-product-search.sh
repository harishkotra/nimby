#!/usr/bin/env bash
set -euo pipefail

server_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
stack="${NIMBY_PRODUCT_SEARCH_STACK:-nimby-product-search}"
secret="${NIMBY_TAVILY_SECRET_NAME:-nimby/demo/tavily}"

aws_cli() {
  aws --region "$region" --no-cli-pager "$@"
}

aws_cli sts get-caller-identity >/dev/null
if ! command -v sam >/dev/null || ! command -v node >/dev/null; then
  printf 'Install the AWS SAM CLI and Node.js to deploy retailer search.\n' >&2
  exit 1
fi

if ! secret_arn=$(aws_cli secretsmanager describe-secret --secret-id "$secret" --query ARN --output text); then
  secret_arn=$(node --env-file-if-exists="$server_dir/../.env" --input-type=module -e '
    const key = process.env.TAVILY_API_KEY?.trim();
    if (!key) throw new Error("Set TAVILY_API_KEY in Nimby’s local .env first.");
    process.stdout.write(key);
  ' | aws_cli secretsmanager create-secret --name "$secret" --secret-string file:///dev/stdin --query ARN --output text)
fi

sam validate --lint --template-file "$server_dir/product-search.aws.yaml" --region "$region"
sam deploy --template-file "$server_dir/product-search.aws.yaml" --stack-name "$stack" --region "$region" \
  --resolve-s3 --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
  --parameter-overrides "TavilySecretArn=$secret_arn" "DailySearchLimit=${NIMBY_DAILY_SEARCH_LIMIT:-60}"

aws_cli cloudformation describe-stacks --stack-name "$stack" \
  --query 'Stacks[0].Outputs[?OutputKey==`ProductSearchUrl`].OutputValue | [0]' --output text
