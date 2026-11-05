// As the owner would, from the desk: agree to the phone that is waiting.
var API = 'http://localhost:4021/api/v1';
var headers = { Authorization: 'Bearer ' + OWNER_TOKEN, 'Content-Type': 'application/json' };
var list = json(http.get(API + '/admin/device-requests', { headers: headers }).body);
var item = list.items[0];
if (!item) throw new Error('No phone is waiting');
var reply = http.post(API + '/admin/device-requests/' + item.id + '/decide', {
  headers: headers,
  body: JSON.stringify({ decision: 'APPROVE' }),
});
if (!reply.ok) throw new Error('Approve failed: ' + reply.status + ' ' + reply.body);
