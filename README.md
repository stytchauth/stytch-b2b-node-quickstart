# Stytch: Node.js and Express

This is a quickstart example project for getting up and running with B2B
authentication. This project includes:

- Email Magic Links
- Sessions

## Setup

### Prerequisites

- Node `^20.14.0` (an `.nvmrc` file is present if you use NVM).
- Created an account with Stytch and have access to the Stytch Dashboard.
    - The Project ID and Secret associated with your Stytch Project (accessible from the dashboard).
    - An Organization in the dashboard with email JIT provisioning enabled (only required if you want to use the
      Organization Magic Links in the project, not needed for Discovery Magic Links).

#### 1. Clone the repository.

```shell
git clone git@github.com:stytchauth/stytch-b2b-node-js-magic-links
```

#### 2. Populate environment variables.

First, copy the `.env` file template:

```shell
cp .env.template .env
```

Then populate `STYTCH_PROJECT_ID` and `STYTCH_SECRET` with the secret variables obtained
from your dashboard.

#### 3. Install dependencies.

```shell
npm i
```

#### 4. Start the server.

```shell
npm run server
```

## Making Requests

You can use `cURL` to make requests against your locally running server.

### Discovery Magic Links

```shell
curl -X POST \
  --url 'http://localhost:3000/magic-links/login-signup' \
  -H 'Content-Type: application/json' \
  -d '{"email": "TEST_EMAIL_HERE"}'
```

### Organization Magic Links

```shell
curl -X POST \
  --url 'http://localhost:3000/magic-links/login-signup' \
  -H 'Content-Type: application/json' \
  -d '
  {
    "email": "TEST_EMAIL_HERE",
    "organizationId": "ORGANIZATION_ID_HERE"
  }'
```
