import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

test("real HTTP direct/trusted chains demonstrate why production header topology is required", async () => {
  const app = express();
  app.get("/ip", (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const request = async forwarded => (await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { "x-forwarded-for": forwarded } })).json();
    app.set("trust proxy", false);
    assert.equal((await request("198.51.100.99")).ip, "127.0.0.1");
    app.set("trust proxy", ["loopback", "192.0.2.10/32"]);
    assert.equal((await request("198.51.100.99, 203.0.113.7, 192.0.2.10")).ip, "203.0.113.7");
    assert.equal((await request("198.51.100.99, 203.0.113.7")).ip, "203.0.113.7");
    app.set("trust proxy", 1);
    assert.equal((await request("198.51.100.99")).ip, "198.51.100.99", "One-hop trust accepts forged headers if the immediate ingress does not overwrite them");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
