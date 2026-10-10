import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const middlewarePath = path.resolve('backend/src/middleware.ts');
const tokenValidatorPath = path.resolve('backend/src/modules/auth/token-validator.ts');

const middlewareOrig = fs.readFileSync(middlewarePath, 'utf8');
const tokenValidatorOrig = fs.readFileSync(tokenValidatorPath, 'utf8');

try {
  console.log('Breaking tenant guard in middleware.ts...');
  const brokenMiddleware = middlewareOrig.replace(
    'const membership = await validateMembership(request.auth.userId,orgId);',
    'const membership = { organizationSlug: "broken", membershipId: "broken-id", roles: ["admin"], membershipStatus: "active" as any };'
  );
  fs.writeFileSync(middlewarePath, brokenMiddleware);

  console.log('Breaking token check in token-validator.ts...');
  const brokenValidator = tokenValidatorOrig.replace(
    /const \{ payload \} = await jose\.jwtVerify\([\s\S]*?clockTolerance: 0,\s*\}\);/,
    'const payload = jose.decodeJwt(token);'
  );
  fs.writeFileSync(tokenValidatorPath, brokenValidator);

  console.log('Running tests...');
  try {
    execSync('npm run test', { cwd: 'backend', stdio: 'inherit' });
    console.error('ERROR: Tests passed unexpectedly despite broken security guards. Test independence verification failed.');
    process.exit(1);
  } catch (error) {
    console.log('\nSUCCESS: Tests failed as expected, proving test assertions independently verify security properties.');
  }
} finally {
  console.log('Restoring original files...');
  fs.writeFileSync(middlewarePath, middlewareOrig);
  fs.writeFileSync(tokenValidatorPath, tokenValidatorOrig);
}
