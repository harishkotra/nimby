# Nimby landing page

Open [the landing page](dist/index.html) in a browser. The site is static and lives entirely in `landing/`. It uses sample photo content and the app’s original mascot and icons.

## Tally waitlist

The published form should ask for:

- **Email address** (required). Use it to contact people about Nimby’s launch.
- **Would you consider paying for Nimby?** (optional). Offer “Yes,” “Maybe, depending on the price,” and “No.”

Set the button label to **Join the waitlist** and use a confirmation such as “You’re on the list. We’ll email you about early access to Nimby.”

The published Tally URL is configured in [waitlist.js](dist/waitlist.js). The page loads Tally’s standard embed.

## Deploy to AWS

Install AWS CLI v2 and sign in with a named profile in the account that should host the site. For IAM Identity Center, use `aws configure sso --profile nimby`. If you already have access keys, use `aws configure --profile nimby`. The deploy script uses the AWS CLI credential chain.

Run this command from the project root.

```sh
AWS_PROFILE=nimby NIMBY_AMPLIFY_APP_ID=d3ulvfvvudr0cr ./landing/deploy-aws.sh
```

The script deploys the static site to the public `production` branch of an Amplify Hosting app named `nimby-landing`. It uses the configured AWS region and defaults to `us-east-1` when a region is absent. Set `NIMBY_AMPLIFY_APP_ID` to deploy to a specific manual static Amplify app. The script prints the HTTPS URL after Amplify serves the uploaded version.

The optional in-app retailer search runs on AWS Lambda and API Gateway. See the [project setup](../README.md#find-buying-links) to connect an Android demo build. The Tavily credential stays in Secrets Manager.
