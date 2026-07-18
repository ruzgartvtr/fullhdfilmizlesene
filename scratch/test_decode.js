function _(e) {
  let t = Buffer.from(e.split("").reverse().join(""), 'base64').toString('utf-8');
  let o = "";
  for (let e = 0; e < t.length; e++) {
    let r = "K9L"[e % 3];
    let n = t.charCodeAt(e) - (r.charCodeAt(0) % 5 + 1);
    o += String.fromCharCode(n);
  }
  return Buffer.from(o, 'base64').toString('utf-8');
}

const input = '==gP/QlT71VWPNXaKB1eIVzV8tDSjdzRJZmN2p0V4lVWlxXO0cmNUlEZ2MXSP5mMvpVSMtVZa9mVlBXZIh2WyVTVU1EbjZVZap1WIhEVHVlVVdTaHRmRqh1UVlVRVlUaXd2SYhkY2kUbZR3Wzc2W6VjVXlUWmFVdHV1dLp1Y4ZmbllnNVhmeYp0Y1l0Mcl3TZRGe3YlT8xjeOljTKZWMUtkY';
console.log('Decoded URL:', _(input));
