// js/auth-guard.js

async function checkLoggedIn() {
  return getCurrentUser();
}

async function requireAuth(redirectTo = '../index.html') {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

async function requireAdmin(redirectTo = '../index.html') {
  const user = await getCurrentUser();
  if (!user || user.profile?.role !== 'admin') {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}
