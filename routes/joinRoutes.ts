import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../core/db';
import { eq, idOf } from '../core/db/query';
import { isDuplicateError, isValidationError, validationMessages } from '../core/db/errors';
import { usernameTaken } from '../core/accounts';
import { consumeInvite, findInvite } from '../core/inviteLinks';
import { issueSession } from '../controllers/authController';
import { isLocalLoginDisabled } from '../config/oidc';
import { normalizeLanguage } from '../config/constants';

/**
 * Public entry point of an invite link (see core/inviteLinks.ts). A visitor without an
 * account creates one here and lands in the collection; a signed-in visitor joins with
 * the account they have. Either way the link is used up.
 */
const router = Router();

const MIN_PASSWORD = 6;

function renderJoin(req: any, res: any, found: { collection: any; invite: any }, extra: Record<string, any> = {}) {
  res.render('join', {
    token: found.invite.token,
    collectionName: found.collection.name,
    role: found.invite.role,
    expiresAt: found.invite.expiresAt,
    alreadyMember: !!req.user && (found.collection.members || []).some((m: any) => String(m.user) === String(req.user._id)),
    error: null,
    values: {},
    ...extra,
  });
}

function invalid(res: any) {
  // Same page whether the token never existed, was used or expired.
  return res.status(404).render('join-invalid');
}

router.get('/join/:token', async (req: any, res: any) => {
  try {
    const found = await findInvite(req.params.token);
    if (!found) return invalid(res);
    renderJoin(req, res, found);
  } catch (err: any) {
    console.error('[ERR] Invite link:', err.message);
    invalid(res);
  }
});

router.post('/join/:token', async (req: any, res: any) => {
  let found: { collection: any; invite: any } | null = null;
  try {
    found = await findInvite(req.params.token);
    if (!found) return invalid(res);
    const collectionId = idOf(found.collection._id);
    const { token, role } = found.invite;

    // Signed in already: the account they have joins, nothing to create.
    if (req.user) {
      const userId = idOf(req.user._id);
      const member = (found.collection.members || []).some((m: any) => String(m.user) === userId);
      if (!member) {
        if (!(await consumeInvite(collectionId, token))) return invalid(res);
        await db.collections.updateOne(eq('_id', collectionId), { addToSet: { members: { user: req.user._id, role } } });
        console.log(`[ADMIN] ${req.user.username} joined collection ${found.collection.name} through an invite link`);
      }
      await db.users.updateOne(eq('_id', userId), { set: { lastActiveCollectionId: found.collection._id } });
      return res.redirect('/');
    }

    // An instance where everyone signs in through SSO has no local accounts to create.
    if (isLocalLoginDisabled()) return renderJoin(req, res, found);

    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const confirm = String(req.body.password_confirm || '');
    const values = { username, email };
    const refuse = (key: string) => renderJoin(req, res.status(400), found!, { error: req.t(key), values });

    if (!username || !email || !password) return refuse('join.err_missing');
    if (password.length < MIN_PASSWORD) return refuse('auth.password_too_short');
    if (password !== confirm) return refuse('join.err_mismatch');
    if (await usernameTaken(username)) return refuse('messages.error_username_taken');

    // Backdated, as on /setup: the session issued below is dated to the second and would
    // otherwise be refused as older than the account.
    const newUser = await db.users.create({
      username,
      email,
      password,
      language: normalizeLanguage(req.language),
      lastChange: new Date(Date.now() - 60_000),
    });
    const newId = idOf(newUser._id);

    // Used up only now that the account exists, so a refused form leaves the link working.
    // Lost to someone faster: the account goes again rather than stay outside any collection.
    if (!(await consumeInvite(collectionId, token))) {
      await db.users.deleteOne(eq('_id', newId));
      return invalid(res);
    }

    await db.users.updateOne(eq('_id', newId), {
      set: { password: await bcrypt.hash(password, 10), lastActiveCollectionId: found.collection._id },
    });
    await db.collections.updateOne(eq('_id', collectionId), { addToSet: { members: { user: newUser._id, role } } });
    console.log(`[ADMIN] User created through an invite link: ${username} <${email}> in ${found.collection.name}`);

    await issueSession(req, res, newUser);
    res.redirect('/');
  } catch (err: any) {
    if (!found) return invalid(res);
    const values = { username: req.body.username, email: req.body.email };
    let key = 'messages.error_user_create';
    if (isDuplicateError(err)) key = isDuplicateError(err, 'username') ? 'messages.error_username_taken' : 'messages.error_email_taken';
    else if (isValidationError(err)) key = Object.values(validationMessages(err))[0] || 'messages.error_user_invalid';
    else console.error('[ERR] Invite link join:', err);
    renderJoin(req, res.status(400), found, { error: req.t(key), values });
  }
});

export = router;
