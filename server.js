const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');
const stytch = require('stytch');

//
// Server configuration.
//

// Instantiate the Express server.
const app = express();

// Use EJS for HTML templating.
app.set('view engine', 'ejs');

app.use(express.static(__dirname + "/static"));

// Handle form submission data.
app.use(bodyParser.urlencoded({extended: true}));

// Session management.
app.use(session({
    resave: true,
    saveUninitialized: false,
    secret: 'session-signing-secret',
    cookie: {maxAge: 60000}
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
// Helper Methods.
//

const SessionKey = 'stytch-session-token';

/**
 * Retrieves the authenticated member and organization from the session, if present.
 * @param req Express request.
 * @returns {Promise<{organization: Organization, member: Member}|null>}
 */
async function getAuthenticatedMemberAndOrg(req) {
    const session = req.session[SessionKey];
    if (!session) {
        return null;
    }

    const resp = await client.sessions.authenticate({session_token: session});
    if (resp.status_code !== 200) {
        console.error('Invalid session found');
        invalidateSession(req);
        return null;
    }

    req.session[SessionKey] = resp.session_token;
    return {
        member: resp.member,
        organization: resp.organization,
    };
}

function invalidateSession(req) {
    req.session[SessionKey] = undefined;
}

//
// Routes.
//

/**
 * Renders the index page.
 */
app.get('/', async (req, res) => {
    // Check for an existing session token in the browser.
    // If one is found, and it corresponds to an active session,
    // redirect the user.
    const session = await getAuthenticatedMemberAndOrg(req);
    if (session && session.member && session.organization) {
        res.render('loggedIn', {
            member: session.member,
            organization: session.organization,
        });
        return;
    }

    res.render('discoveryLogin');
});

app.get('/logout', (req, res) => {
    res.render('discoveryLogin');
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
app.post('/send-magic-link', async (req, res) => {
    const email = req.body.email;
    if (!email) {
        res.status(400).send('Email is required');
        return;
    }

    const organizationId = req.body.organizationId;
    if (!organizationId) {
        const resp = await client.magicLinks.email.discovery.send({
            email_address: email,
        });
        if (resp.status_code !== 200) {
            console.error(JSON.stringify(resp, null, 2));
            res.status(500).send('Error requesting magic link');
            return;
        }
        res.render('emailSent');
        return;
    }

    const resp = await client.magicLinks.email.loginOrSignup({
        email_address: email,
        organization_id: organizationId,
    });
    if (resp.status_code !== 200) {
        console.error(JSON.stringify(resp, null, 2));
        res.status(500).send('Error requesting magic link');
        return;
    }
    res.render('emailSent');
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
        if (resp.status_code !== 200) {
            console.error('Authentication error')
            res.status(500).send();
            return;
        }

        req.session.ist = resp.intermediate_session_token;
        const orgs = [];
        for (const org of resp.discovered_organizations) {
            orgs.push({
                organizationId: org.organization.organization_id,
                organizationName: org.organization.organization_name,
            });
        }

        res.render('discoveredOrganizations', {
            isLogin: true,
            email: resp.email_address,
            discoveredOrganizations: orgs,
        });
        return;
    }

    // Handle Organization authentication.
    if (tokenType === 'multi_tenant_magic_links') {
        const resp = await client.magicLinks.authenticate({
            magic_links_token: token,
        });
        if (resp.status_code !== 200) {
            console.error('Authentication error')
            res.status(500).send();
            return;
        }

        req.session[SessionKey] = resp.session_token;
        res.redirect('/');
        return;
    }

    console.error(`Unrecognized token type: '${tokenType}'`);
    res.status(400).send();
});

// Start the server.
console.warn('\x1b[31m%s\x1b[0m', 'WARNING: FOR DEVELOPMENT PURPOSES ONLY, NOT INTENDED FOR PRODUCTION USE');

const port = process.env.PORT
    ? parseInt(process.env.PORT)
    : 3000;

app.listen(port, () => {
    console.log(`Server starting on: http://localhost:${port}`);
});
