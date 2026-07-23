import jwt from 'jsonwebtoken';
import User from '../models/User';

export const requireAuth = async (req: Record<string, any>, res: any, next: any) => {
  const token = req.cookies.jwt;

  if (token) {

    const passjwt: string | undefined = process.env.PASSJWT;

    if (!passjwt) {
      throw new Error("The environement variable PASSJWT is missing.");
    }

    jwt.verify(token, passjwt, async (err: any, decodedToken: any) => {
      if (err) {
        console.log(err.message);
        return res.redirect('/login');
      } else {
        // Retrieve the user and attach it to req.user
        const user = await User.findById(decodedToken.id);
        if (!user || (user && user.lastChange && decodedToken.iat * 1000 < user.lastChange.getTime())) {
          if (res.cookie('jwt')) res.cookie('jwt', '', { maxAge: 1 });
          return res.redirect('/login');
        }
        req.user = user; // Attach the user to req.user
        next();
      }
    });
  } else {
    res.redirect('/login');
  }
};


export const checkUser = (req: Record<string, any>, res: any, next: any) => {

  const token = req.cookies.jwt;

  res.locals.user = null;
  res.locals.isAdmin = false;
  req.user = null;

  const passjwt: string | undefined = process.env.PASSJWT;

  if (!passjwt) {
    throw new Error("The environement variable PASSJWT is missing.");
  }

  if (token) {
    jwt.verify(token, passjwt, async (err: any, decodedToken: any) => {
      if (err) {
        res.locals.user = null;
        req.user = null;
        next();
      } else {
        let user = await User.findById(decodedToken.id);
        res.locals.user = user;
        req.user = user;

        if (user && user.isAdmin === true) {
          res.locals.isAdmin = true;
        }

        next();
      }
    });
  } else {
    res.locals.user = null;
    req.user = null;
    next();
  }
};

export const requireAdmin = (req: any, res: any, next: any) => {
  const user = res.locals.user;

  if (user && user.isAdmin === true) {
    next(); // Admin, allow
  } else {
    res.redirect('/'); // Not admin, redirect
  }
};

const ROLE_LEVEL: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

/**
 * Gates a route on the user's role in the ACTIVE collection (set by collectionMiddleware).
 * Instance admins always pass (their collectionRole is forced to 'admin').
 * Role ladder: viewer < editor < admin.
 */
export const requireCollectionRole = (minRole: 'viewer' | 'editor' | 'admin') => {
  return (req: any, res: any, next: any) => {
    const role = res.locals.collectionRole;
    if (role && (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[minRole] ?? 99)) {
      return next();
    }
    // Mirror requireAdmin's behavior for pages; JSON for API-style calls
    if (req.method !== 'GET' && (req.xhr || (req.headers.accept || '').includes('json'))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    res.redirect('/');
  };
};
