const express = require('express');
const session = require('express-session');
const stytch = require('stytch');

//
// Server configuration.
//

// Instantiate the Express server.
const app = express();

// Parse request body JSON.
app.use(express.json());
// Session management.
app.use(session({
    resave: true,
    saveUninitialized: false,
    secret: 'session-signing-secret',
}));

// Retrieve project id and secret.
const projectId = process.env.STYTCH_PROJECT_ID;
const secret = process.env.STYTCH_SECRET;
if (!projectId || !secret) {
    throw new Error('Project id or secret not provided.');
}

// Instantiate a Stytch B2B client.
const client = new stytch.B2BClient({
    project_id: projectId,
    secret: secret,
});

//
// Magic Links server routes.
//

/**
 * Uses a Magic Link to sign up a user or log in an existing user.
 *
 * If an Organization ID is present in the request body, an Organization
 * Magic Link is sent to the provided email. Otherwise, a Discovery
 * Magic Link is sent.
 *
 * To understand the difference between these, see: https://stytch.com/docs/b2b/guides/login-flows.
 */
app.post('/magic-links/login-signup', async (req, res) => {
    const email = req.body.email;
    if (!email) {
        res.status(400).send('Email is required');
        return;
    }

    const organizationId = req.body.organizationId;
    if (organizationId) {
        // If an organization id is present in the request body perform
        // an Organization login.
        const resp = await client.magicLinks.email.loginOrSignup({
            email_address: email,
            organization_id: organizationId,
        });

        // Handle error response.
        if (resp.status_code !== 200) {
            console.error(`Error sending Organization Magic Link, resp: '${JSON.stringify(resp)}'`);
            res.status(500).send();
            return;
        }

        console.log(`Success - Organization Magic Link sent to ${email}`);
        res.status(200).send();
    } else {
        // If no organization id is present then perform a Discovery Login.
        const resp = await client.magicLinks.email.discovery.send({email_address: email});

        // Handle error response
        if (resp.status_code !== 200) {
            console.error(`Error sending Discovery Magic Link, resp: '${JSON.stringify(resp)}'`);
            res.status(500).send();
            return;
        }

        console.log(`Success - Discovery Magic Link sent to ${email}`);
        res.status(200).send();
    }
});

/**
 * Handles authentication for Magic Links.
 *
 * By default, all Redirect URLs are set to `http://localhost:3000/authenticate`
 * for the Test environment. You can add or configure Redirect URLs in your
 * Stytch Dashboard.
 *
 * For more information on Redirect URLs, see: https://stytch.com/docs/b2b/guides/dashboard/redirect-urls.
 */
app.get('/authenticate', async (req, res) => {
    const tokenType = req.query.stytch_token_type;
    const token = req.query.token;

    if (!token) {
        console.error('Token not present in request query string');
        res.status(400).send('Token is required');
        return;
    }

    // Handle Discovery authentication.
    if (tokenType === 'discovery') {
        const resp = await client.magicLinks.discovery.authenticate({
            discovery_magic_links_token: token,
        });

        // Handle error.
        if (resp.status_code !== 200) {
            console.error('Authentication error')
            res.status(500).send();
            return;
        }

        // On success an IST is available and can be stored as a cookie
        // or other mechanism for subsequent requests for exchange.
        console.log('Success - intermediate session token retrieved');
        req.session.ist = resp.intermediate_session_token;
        res.status(200).send();
        return;
    }

    // Handle Organization authentication.
    if (tokenType === 'multi_tenant_magic_links') {
        const resp = await client.magicLinks.authenticate({
            magic_links_token: token,
        });

        // Handle error.
        if (resp.status_code !== 200) {
            console.error('Authentication error')
            res.status(500).send();
            return;
        }

        // On success a JWT is available for the logged in member.
        // This can be stored on the session for re-use.
        console.log('Success - JWT retrieved');
        req.session['stytch-session'] = resp.session_jwt;
        res.status(200).json({
            member: resp.member,
        });
        return;
    }

    console.error(`Unrecognized token type: '${tokenType}'`);
    res.status(400).send();
});

// Start the server.
const port = process.env.PORT
    ? parseInt(process.env.PORT)
    : 3000;

app.listen(port, () => {
    console.log(`Server starting on port ${port}...`);
});
