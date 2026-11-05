// The code on the shop's wall right now, from the server.
var wall = json(
  http.get('http://localhost:4021/api/v1/screen/today', {
    headers: { 'x-shop-screen': SCREEN_TOKEN },
  }).body,
);
output.qr = wall.qr;
