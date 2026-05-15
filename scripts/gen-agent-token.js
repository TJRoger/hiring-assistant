import crypto from 'crypto';
console.log('sk-' + crypto.randomBytes(24).toString('hex'));
