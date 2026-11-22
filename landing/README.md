# Nimby landing page

Open [the landing page](dist/index.html) in a browser. The site is static and lives entirely in `landing/`. It uses sample photo content and the app’s original mascot and icons.

## Tally beta signup

The beta signup should require an **Email address** for beta invites. Use **Request beta access** for the button and “Thanks for signing up. We’ll email you when beta invites open.” for the confirmation.

The published Tally URL is configured in [waitlist.js](dist/waitlist.js). The page loads Tally’s standard embed.

## Deploy to AWS

Install AWS CLI v2 and sign in with a named profile in the account that should host the site. For IAM Identity Center, use `aws configure sso --profile nimby`. If you already have access keys, use `aws configure --profile nimby`. The deploy script uses the AWS CLI credential chain.

Run this command from the project root.

```sh
AWS_PROFILE=nimby NIMBY_AMPLIFY_APP_ID=d3ulvfvvudr0cr ./landing/deploy-aws.sh
```

The command updates [the existing production page](https://production.d3ulvfvvudr0cr.amplifyapp.com/) with the Lifetime pricing card and the Tally beta signup section. The configured checkout uses Dodo’s test environment. The script uses the configured AWS region and defaults to `us-east-1`. It prints the HTTPS URL after verifying the published HTML.

### Deploy with retailer search

Install AWS SAM CLI and put `TAVILY_API_KEY` in the gitignored `.env` at the repository root. Deploy the backend and the landing page in one command.

```sh
AWS_PROFILE=nimby NIMBY_AMPLIFY_APP_ID=d3ulvfvvudr0cr NIMBY_DEPLOY_PRODUCT_SEARCH=1 ./landing/deploy-aws.sh
```

The script checks the API Gateway route, then publishes its public URL in `/product-search.json`. Nimby reads that file when someone opens **Find buying links** and sends the confirmed product name to Lambda. The Tavily credential stays in Secrets Manager. Future landing deploys can read the URL from the existing stack without redeploying it. [App configuration](../README.md#find-buying-links)

## Lifetime sandbox demo

The shared [sandbox product settings](lifetime-demo.json) identify the one-time Dodo product and its display price. Dodo sends the key with instructions after a successful test checkout. The test entitlement allows one active installation and has no expiration.

To preview the same checkout on a separate Amplify branch, target `demo`.

```sh
AWS_PROFILE=nimby NIMBY_AMPLIFY_BRANCH=demo ./landing/deploy-aws.sh
```

For a local pricing preview, generate a new output directory and open its `index.html`.

```sh
node landing/build-demo.mjs /tmp/nimby-lifetime-site
```

Build and install the sandbox license variant on a connected Android device.

```sh
EXPO_PUBLIC_NIMBY_LICENSE_DEMO=1 npm run android:demo
```

Redeem the emailed key in **Settings → License**. The key unlocks **Plan from saved photos** and **Review past choices** in Explore. Release the device before reinstalling or switching phones. If the old installation is unavailable or an activation request lost its response, verify the purchase in Dodo Test Mode, locate the key’s active instance, and reset it through Dodo before retrying. The offline window lasts up to seven days after a successful check.

Use a sideloaded build for this sandbox showcase. The normal build stays available without the demo flag.
