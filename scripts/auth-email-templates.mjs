#!/usr/bin/env node
/**
 * Auth email HTML (ox tokens) + optional hosted apply.
 *
 *   node scripts/auth-email-templates.mjs           # write supabase/templates
 *   node scripts/auth-email-templates.mjs --apply   # write + PATCH prod Auth
 *
 * --apply needs SUPABASE_ACCESS_TOKEN. Does not set custom SMTP.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'supabase/templates');
const PROJECT_REF = 'vjdgdolfxvnxushxrmff';
const SITE = 'https://firstcrackiscoming.com';
const CONFIRM = '{{ .ConfirmationURL }}';
const TOKEN = '{{ .Token }}';

const URI_ALLOW_LIST = [
    'http://localhost:4321/auth/callback',
    'http://localhost:4322/auth/callback',
    'http://localhost:1420/auth/callback',
    'firstcrack://auth/callback',
    `${SITE}/**`,
].join(',');

/** @typedef {{
 *   file: string
 *   subject: string
 *   title: string
 *   preheader: string
 *   eyebrow: string
 *   heading: string
 *   lead: string
 *   cta?: string
 *   extra?: string
 *   footer: string
 * }} AuthMail
 */

/** @type {AuthMail[]} */
const MAILS = [
    {
        file: 'confirmation.html',
        subject: 'Confirm your First Crack account',
        title: 'Confirm your email',
        preheader: 'Confirm this email to finish creating your First Crack account.',
        eyebrow: 'Signup',
        heading: 'Confirm your email',
        lead: 'Click the button to confirm this address and finish creating your account.',
        cta: 'Confirm email',
        footer: "If you didn't create a First Crack account, you can ignore this email.",
    },
    {
        file: 'recovery.html',
        subject: 'Reset your First Crack password',
        title: 'Reset your password',
        preheader: 'Use this link to choose a new First Crack password.',
        eyebrow: 'Password',
        heading: 'Reset your password',
        lead: 'Click the button to choose a new password for your account.',
        cta: 'Reset password',
        footer: "If you didn't ask to reset your password, you can ignore this email.",
    },
    {
        file: 'magic_link.html',
        subject: 'Sign in to First Crack',
        title: 'Sign in to First Crack',
        preheader: 'Use this link to sign in to your First Crack account.',
        eyebrow: 'Sign in',
        heading: 'Sign in to First Crack',
        lead: 'Click the button to sign in. This link expires soon.',
        cta: 'Sign in',
        footer: "If you didn't try to sign in, you can ignore this email.",
    },
    {
        file: 'email_change.html',
        subject: 'Confirm your new email',
        title: 'Confirm your new email',
        preheader: 'Confirm this address to finish changing your First Crack email.',
        eyebrow: 'Email',
        heading: 'Confirm your new email',
        lead: 'Click the button to confirm this address as the email for your account.',
        cta: 'Confirm email',
        footer: "If you didn't ask to change your email, you can ignore this email.",
    },
    {
        file: 'invite.html',
        subject: "You're invited to First Crack",
        title: "You're invited to First Crack",
        preheader: 'Accept your invite and create your First Crack account.',
        eyebrow: 'Invite',
        heading: 'You have been invited',
        lead: 'Accept to create your account and join the workspace.',
        cta: 'Accept the invite',
        footer: "If you didn't expect this invite, you can ignore this email.",
    },
    {
        file: 'reauthentication.html',
        subject: 'Your First Crack confirmation code',
        title: 'Confirmation code',
        preheader: 'Your First Crack confirmation code.',
        eyebrow: 'Verify',
        heading: 'Confirmation code',
        lead: 'Enter this code to continue.',
        extra: tokenBox(TOKEN),
        footer: "If you didn't request this code, you can ignore this email.",
    },
];

function tokenBox(code) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0 0" width="100%">
                  <tr>
                    <td style="background-color:#fafaf9;border:1px solid rgba(8,5,3,0.12);padding:20px 24px;text-align:center;font-family:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;font-size:28px;font-weight:500;letter-spacing:0.12em;color:#080503">
                      ${code}
                    </td>
                  </tr>
                </table>`;
}

function ctaButton(label) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0 0" width="100%">
                  <tr>
                    <td>
                      <a href="${CONFIRM}" style="display:block;background-color:#080503;color:#ffffff;font-size:14px;font-weight:500;letter-spacing:-0.01em;text-align:center;text-decoration:none;padding:14px 24px;border-radius:0">${label}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:13px;line-height:1.55;color:#5e534a">
                  Button not working? Copy this link:
                </p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;word-break:break-all">
                  <a href="${CONFIRM}" style="color:#080503;text-decoration:underline;text-underline-offset:2px">${CONFIRM}</a>
                </p>`;
}

/** @param {AuthMail} mail */
function render(mail) {
    const action = mail.cta ? ctaButton(mail.cta) : (mail.extra ?? '');
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${mail.title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fafaf9;color:#080503;font-family:'Instrument Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${mail.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafaf9;width:100%">
      <tr>
        <td align="center" style="padding:48px 24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%">
            <tr>
              <td style="padding:0 0 28px 0">
                <a href="${SITE}" style="color:#080503;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:-0.02em">First Crack</a>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;border:1px solid rgba(8,5,3,0.08);padding:40px 32px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width:32px;border-top:1px solid #5e534a;vertical-align:middle;padding-right:10px"></td>
                    <td style="font-family:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;font-size:12px;font-weight:400;color:#5e534a;letter-spacing:0.04em;text-transform:uppercase;vertical-align:middle">${mail.eyebrow}</td>
                  </tr>
                </table>
                <h1 style="margin:16px 0 0 0;font-size:28px;font-weight:500;line-height:1.2;letter-spacing:-0.03em;color:#080503">${mail.heading}</h1>
                <p style="margin:16px 0 0 0;font-size:16px;line-height:1.6;color:#5e534a">${mail.lead}</p>
                ${action}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 4px 0 4px;font-size:12px;line-height:1.5;color:#5e534a">
                ${mail.footer}
                <br />
                <span style="color:rgba(8,5,3,0.45)">© First Crack</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

function writeTemplates() {
    mkdirSync(OUT, { recursive: true });
    for (const mail of MAILS) {
        writeFileSync(join(OUT, mail.file), render(mail));
    }
}

function patchBody() {
    /** @type {Record<string, string>} */
    const body = { uri_allow_list: URI_ALLOW_LIST };
    for (const mail of MAILS) {
        const key = mail.file.replace('.html', '');
        body[`mailer_subjects_${key}`] = mail.subject;
        body[`mailer_templates_${key}_content`] = readFileSync(join(OUT, mail.file), 'utf8');
    }
    return body;
}

async function applyHosted() {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) {
        throw new Error('SUPABASE_ACCESS_TOKEN is required for --apply');
    }
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchBody()),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`auth config PATCH ${res.status}: ${text.slice(0, 500)}`);
    }
}

writeTemplates();
if (process.argv.includes('--apply')) {
    await applyHosted();
    console.log('wrote templates and patched hosted auth');
} else {
    console.log(`wrote ${MAILS.length} templates under supabase/templates`);
}
