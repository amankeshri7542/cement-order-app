// "Phone kho gaya: abhi band karo", from the desk.
var reply = http.post('http://localhost:4021/api/v1/admin/staff/driver/device/revoke', {
  headers: { Authorization: 'Bearer ' + OWNER_TOKEN, 'Content-Type': 'application/json' },
  body: '{}',
});
if (!reply.ok) throw new Error('Revoke failed: ' + reply.status + ' ' + reply.body);
