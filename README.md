# Stytch: Node.js B2B Magic Links Demo

This is a quickstart example project for getting up and running with B2B
authentication. This project includes:

- Email Magic Links
- Sessions

## Setup

### Prerequisites

- Node `^20.14.0` (an `.nvmrc` file is present if you use NVM).
- Created an account with Stytch and have access to the Stytch Dashboard.
    - The Project ID and Secret associated with your Stytch Project (accessible from the dashboard).

#### 1. Clone the repository.

```shell
git clone git@github.com:stytchauth/stytch-node-b2b-magic-links.git
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
