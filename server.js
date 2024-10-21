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

app.use(express.static(__dirname + '/static'));

// Handle form submission data.
app.use(bodyParser.urlencoded({ extended: true }));

// Session management.
app.use(
  session({
    resave: true,
    saveUninitialized: false,
    secret: 'session-signing-secret',
    cookie: { maxAge: 60000 },
  })
);

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

const StytchSessionKey = 'stytch-session-token';
const StytchIstKey = 'ist';

/**
 * Retrieves the authenticated member and organization from the session, if present.
 * @param req Express request.
 * @returns {Promise<{organization: Organization, member: Member}|null>}
 */
async function getAuthenticatedMemberAndOrg(req) {
  const session = req.session[StytchSessionKey];
  if (!session) {
    return null;
  }

  const resp = await client.sessions.authenticate({ session_token: session });
  if (resp.status_code !== 200) {
    console.error('Invalid session found');
    invalidateSession(req);
    return null;
  }

  req.session[StytchSessionKey] = resp.session_token;
  return {
    member: resp.member,
    organization: resp.organization,
  };
}

/**
 * Destroys any existing sessions.
 * @param req Express request.
 */
function invalidateSession(req) {
  req.session[StytchSessionKey] = undefined;
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

  let authenticatedEmail = '';
  let responseDiscoveredOrganizations = [];

  if (tokenType === 'discovery') {
    // Handle Discovery authentication.
    const resp = await client.magicLinks.discovery.authenticate({
      discovery_magic_links_token: token,
    });
    if (resp.status_code !== 200) {
      console.error('Authentication error');
      res.status(500).send();
      return;
    }

    req.session[StytchIstKey] = resp.intermediate_session_token;
    responseDiscoveredOrganizations = resp.discovered_organizations;
    authenticatedEmail = resp.email_address;
  } else if (tokenType === 'discovery_oauth') {
    // Handle Discovery OAuth authentication.
    const resp = await client.oauth.discovery.authenticate({
      discovery_oauth_token: token,
    });
    if (resp.status_code !== 200) {
      console.error('Authentication error');
      res.status(500).send();
      return;
    }

    req.session[StytchSessionKey] = resp.session_token;
    responseDiscoveredOrganizations = resp.discovered_organizations;
    authenticatedEmail = resp.email_address;
  } else {
    console.error(`Unrecognized token type: '${tokenType}'`);
    res.status(400).send();
    return;
  }

  const orgs = [];
  for (const org of responseDiscoveredOrganizations) {
    orgs.push({
      organizationId: org.organization.organization_id,
      organizationName: org.organization.organization_name,
    });
  }
  res.render('discoveredOrganizations', {
    isLogin: true,
    email: authenticatedEmail,
    discoveredOrganizations: orgs,
  });
});

/**
 * Creates a new Organization after Discovery authentication.
 * Exchanges an IST returned from a discovery.authenticate() call, allowing
 * Stytch to enforce that users are properly authenticated and verified
 * prior to creating an Organization.
 */
app.post('/create-organization', async (req, res) => {
  const ist = req.session[StytchIstKey];
  if (!ist) {
    console.error('IST required to create an Organization');
    res.status(400).send();
    return;
  }

  const orgName = (req.body.orgName || '').trim();
  const orgSlug = (req.body.orgSlug || '').replaceAll(' ', '');
  const resp = await client.discovery.organizations.create({
    intermediate_session_token: ist,
    organization_name: orgName,
    organization_slug: orgSlug,
  });
  if (resp.status_code !== 200) {
    console.error(
      `Error creating Organization: '${JSON.stringify(resp, null, 2)}'`
    );
    res.status(500).send();
    return;
  }

  req.session[StytchIstKey] = undefined;
  req.session[StytchSessionKey] = resp.session_token;
  res.redirect('/');
});

/**
 * After Discovery, users can opt to log into an existing Organization
 * that they belong to, or are eligible to join by Email Domain JIT Provision, or a
 * pending invite.
 * You will exchange the IST returned from the discovery.authenticate() method call
 * to complete the login process.
 */
app.get('/exchange/:organizationId', async (req, res) => {
  const ist = req.session[StytchIstKey];
  const organizationId = req.params.organizationId;

  if (ist) {
    const resp = await client.discovery.intermediateSessions.exchange({
      intermediate_session_token: ist,
      organization_id: organizationId,
    });
    if (resp.status_code !== 200) {
      console.error(
        `Error exchanging IST into Organization: ${JSON.stringify(
          resp,
          null,
          2
        )}`
      );
      res.status(500).send();
    }

    req.session[StytchIstKey] = undefined;
    req.session[StytchSessionKey] = resp.session_token;
    res.redirect('/');
    return;
  }

  const session = req.session[StytchSessionKey];
  if (!session) {
    console.error('Either IST or session token is required');
    res.status(400).send();
  }

  const resp = await client.sessions.exchange({
    organization_id: organizationId,
    session_token: session,
  });
  if (resp.status_code !== 200) {
    console.error(
      `Error exchanging session token into Organization: ${JSON.stringify(
        resp,
        null,
        2
      )}`
    );
    res.status(500).send();
    return;
  }

  req.session[StytchSessionKey] = resp.session_token;
  res.redirect('/');
});

/**
 * Example of Organization Switching post-authentication.
 * This allows a logged in Member of one Organization to "exchange" their
 * session for a session on another Organization that they belong to,
 * all while ensuring that each Organization's authentication requirements are honored
 * and respecting data isolation between tenants.
 */
app.get('/switch-orgs', async (req, res) => {
  const session = req.session[StytchSessionKey];
  if (!session) {
    res.redirect('/');
    return;
  }

  const resp = await client.discovery.organizations.list({
    session_token: session,
  });
  if (resp.status_code !== 200) {
    console.error(
      `Error listing discovered Organizations: ${JSON.stringify(resp, null, 2)}`
    );
    res.status(500).send();
    return;
  }

  const orgs = [];
  for (const org of resp.discovered_organizations) {
    orgs.push({
      organizationId: org.organization.organization_id,
      organizationName: org.organization.organization_name,
    });
  }

  res.render('discoveredOrganizations', {
    isLogin: false,
    discoveredOrganizations: orgs,
    email: resp.email_address,
  });
});

/**
 * Performs an Organization log in (if logged out), otherwise
 * performs a Session Exchange (if logged in).
 */
app.get('/orgs/:organizationSlug', async (req, res) => {
  const organizationSlug = req.params.organizationSlug;
  const memberAndOrg = await getAuthenticatedMemberAndOrg(req);

  if (memberAndOrg?.member && memberAndOrg?.organization) {
    if (organizationSlug === memberAndOrg.organization.organization_slug) {
      // User is currently logged into this Organization.
      res.redirect('/');
      return;
    }

    const resp = await client.discovery.organizations.list({
      session_token: req.session[StytchSessionKey],
    });
    if (resp.status_code !== 200) {
      console.error(
        `Error listing discovered Organization: ${JSON.stringify(
          resp,
          null,
          2
        )}`
      );
      res.status(500).send();
      return;
    }

    for (const org of resp.discovered_organizations) {
      if (org.organization.organization_slug === organizationSlug) {
        res.redirect(`/exchange/${org.organization.organization_id}`);
        return;
      }
    }
  }
});

/**
 * Performs authorized updating of Organization Settings + Just-in-Time (JIT) Provisioning
 * Once enabled:
 * 1. Logout
 * 2. Initiate magic link for an email alias (e.g. ada+1@stytch.com)
 * 3. After clicking the Magic Link you'll see the option to join the organization with JIT enabled
 * Use your work email address to test this, as JIT cannot be enabled for common email domains.
 */
app.get('/enable-jit', async (req, res) => {
  const memberAndOrg = await getAuthenticatedMemberAndOrg(req);
  if (!memberAndOrg?.member || !memberAndOrg.organization) {
    res.redirect('/');
    return;
  }
  const { member, organization } = memberAndOrg;
  const domain = member.email_address.split('@')[1];

  // When the session_token or session_jwt are passed into method_options
  // Stytch will do AuthZ enforcement based on the Session Member's RBAC permissions
  // before honoring the request.
  const resp = await client.organizations.update(
    {
      organization_id: organization.organization_id,
      email_jit_provisioning: 'RESTRICTED',
      email_allowed_domains: [domain],
    },
    {
      authorization: req.session[StytchSessionKey],
    }
  );
  if (resp.status_code !== 200) {
    console.error(
      `Error updating Organization JIT Provisioning settings: ${JSON.stringify(
        resp,
        null,
        2
      )}`
    );
    res.status(500).send();
    return;
  }

  res.redirect('/');
});

// Start the server.
console.warn(
  '\x1b[31m%s\x1b[0m',
  'WARNING: FOR DEVELOPMENT PURPOSES ONLY, NOT INTENDED FOR PRODUCTION USE'
);

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.listen(port, () => {
  console.log(`Server starting on: http://localhost:${port}`);
});
