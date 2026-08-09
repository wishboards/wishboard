import db from '../../server/db.js';
import { createSalt, hashPassphrase } from '../../server/auth.js';
import { promptPassphrase } from './auth.js';
import { getEventProfile } from '../../server/configManager.js';

export async function resetPassword(
  username,
  newPassphrase,
  opts = {},
  consoleLog = console.log,
  consoleError = console.error
) {
  if (opts.dryRun) {
    consoleLog(
      `Would have reset password for '${username}' ` +
        (opts.url ? `remotely at ${opts.url}` : 'locally') +
        '.'
    );
    return true;
  }

  if (opts.url) {
    const token = await getAdminToken(opts.url, opts, consoleError);
    if (!token) {
      return false;
    }

    const resetRes = await fetch(`${opts.url}/api/admin/users/${username}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newPassphrase ? { passphrase: newPassphrase } : {}),
    });

    if (!resetRes.ok) {
      consoleError(`Error resetting password remotely: ${resetRes.statusText}`);
      return false;
    }

    const resetData = await resetRes.json();
    consoleLog(`\nSuccess! Passphrase for '${username}' has been reset remotely.`);
    consoleLog(`New Passphrase: ${resetData.new_passphrase}\n`);
    return true;
  }

  let passphrase = newPassphrase;
  if (!passphrase) {
    const { generatePassphrase } = await import('../../client/src/passphrase.js');
    passphrase = generatePassphrase();
  }

  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);

  if (!user) {
    consoleError(`Error: User '${username}' not found in the database.`);
    return false;
  }

  const salt = createSalt();
  const hash = await hashPassphrase(passphrase, salt);

  await db
    .prepare('UPDATE users SET passphrase_hash = ?, passphrase_salt = ? WHERE id = ?')
    .run(hash, salt, user.id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  consoleLog(`\nSuccess! Passphrase for '${username}' has been reset locally.`);
  consoleLog(`New Passphrase: ${passphrase}\n`);
  return true;
}

/**
 * Resets the rules table to the bundled defaults by clearing and re-seeding.
 * Preserves all other tables (users, wishes, images, etc.).
 * Supports both local and remote (--url) execution via API.
 */
export async function resetRules(
  opts = {},
  consoleLog = console.log,
  consoleError = console.error
) {
  if (opts.dryRun) {
    consoleLog(
      `Would have reset matching rules to bundled defaults ` +
        (opts.url ? `remotely at ${opts.url}` : 'locally') +
        '.'
    );
    return true;
  }

  if (opts.url) {
    const token = await getAdminToken(opts.url, opts, consoleError);
    if (!token) {
      return false;
    }

    const resetRes = await fetch(`${opts.url}/api/admin/reset-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts.force ? { force: true } : {}),
    });

    if (!resetRes.ok) {
      const errorData = await resetRes.json();
      consoleError(
        `Error resetting rules remotely: ${resetRes.statusText}${errorData.error ? ' — ' + errorData.error : ''}`
      );
      return false;
    }

    const resetData = await resetRes.json();
    consoleLog(`\nSuccess! Matching rules have been reset to defaults.`);
    consoleLog(`Rules re-seeded: ${resetData.rules_count}\n`);
    return true;
  }

  try {
    // Clear existing rules
    await db.prepare('DELETE FROM rules').run();
    consoleLog('Cleared existing rules.');

    // Re-seed default rules from profile
    const profileRules = getEventProfile().rules;
    const mapArg = (a) => {
      if (a === undefined) return null;
      if (typeof a === 'boolean') return a ? 1 : 0;
      return a;
    };

    const stmts = profileRules.map((rule) => ({
      sql: `INSERT INTO rules (id, rule_type, trigger_attribute, trigger_value, context_attribute, context_value, target_attribute, target_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        rule.id,
        rule.rule_type,
        rule.trigger_attribute,
        rule.trigger_value,
        rule.context_attribute,
        rule.context_value,
        rule.target_attribute,
        rule.target_value,
      ].map(mapArg),
    }));

    const BATCH_SIZE = 1000;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const batch = stmts.slice(i, i + BATCH_SIZE);
      await db.batch(batch, 'write');
    }

    consoleLog(`\nSuccess! Matching rules have been reset to defaults.`);
    consoleLog(`Rules re-seeded: ${profileRules.length}\n`);
    return true;
  } catch (err) {
    consoleError(`Error resetting rules: ${err.message}`);
    return false;
  }
}

/**
 * Log in to the remote admin API and return the session token.
 * Returns null if the login fails.
 */
async function getAdminToken(url, opts, consoleError) {
  const adminUser = opts.admin || 'admin';
  const adminPass = await promptPassphrase(`Enter passphrase for ${adminUser}: `);

  const loginRes = await fetch(`${url}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, passphrase: adminPass }),
  });

  if (!loginRes.ok) {
    consoleError(`Error logging in as admin: ${loginRes.statusText}`);
    return null;
  }

  const loginData = await loginRes.json();
  return loginData.token;
}

export async function setSsmToken(
  name,
  value,
  opts = {},
  consoleLog = console.log,
  consoleError = console.error
) {
  if (opts.dryRun) {
    consoleLog(`[DRY RUN] Would store SSM parameter '${name}' (SecureString)`);
    return true;
  }

  try {
    const { SSMClient, PutParameterCommand } = await import('@aws-sdk/client-ssm');
    const region =
      opts.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const ssm = new SSMClient({ region });
    await ssm.send(
      new PutParameterCommand({
        Name: name,
        Value: value,
        Type: 'SecureString',
        Overwrite: true,
      })
    );
    consoleLog(`Successfully stored SSM SecureString parameter '${name}' in region '${region}'.`);
    return true;
  } catch (err) {
    consoleError(`Error setting SSM parameter '${name}': ${err.message}`);
    return false;
  }
}
