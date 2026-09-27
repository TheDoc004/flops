const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { buildTestApp, createUser } = require('./helpers');
const {
  getServerInfo,
  getHealthInfo,
  _resetBuildInfoCacheForTests,
} = require('../buildInfo');
const { createFlopsMcpServer } = require('../mcp/createMcpServer');

const BUILD_INFO_PATH = path.join(__dirname, '..', 'build-info.json');

describe('buildInfo / get_server_info', () => {
  const prev = {
    RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
    GIT_COMMIT: process.env.GIT_COMMIT,
    SOURCE_VERSION: process.env.SOURCE_VERSION,
    COMMIT_SHA: process.env.COMMIT_SHA,
    RENDER_GIT_BRANCH: process.env.RENDER_GIT_BRANCH,
    RENDER_SERVICE_NAME: process.env.RENDER_SERVICE_NAME,
  };
  let hadBuildInfo = false;
  let priorBuildInfo = null;

  beforeEach(() => {
    for (const k of Object.keys(prev)) delete process.env[k];
    if (fs.existsSync(BUILD_INFO_PATH)) {
      hadBuildInfo = true;
      priorBuildInfo = fs.readFileSync(BUILD_INFO_PATH);
      fs.unlinkSync(BUILD_INFO_PATH);
    } else {
      hadBuildInfo = false;
      priorBuildInfo = null;
    }
    _resetBuildInfoCacheForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (fs.existsSync(BUILD_INFO_PATH)) fs.unlinkSync(BUILD_INFO_PATH);
    if (hadBuildInfo && priorBuildInfo) fs.writeFileSync(BUILD_INFO_PATH, priorBuildInfo);
    _resetBuildInfoCacheForTests();
  });

  it('prefers build-info.json for git_sha and built_at', () => {
    fs.writeFileSync(
      BUILD_INFO_PATH,
      JSON.stringify({
        git_sha: 'abcdef0123456789abcdef0123456789abcdef01',
        built_at: '2026-09-27T12:00:00.000Z',
        git_branch: 'main',
      })
    );
    _resetBuildInfoCacheForTests();
    process.env.RENDER_GIT_COMMIT = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const info = getServerInfo({ tools: ['get_day', 'get_server_info'] });
    expect(info.git_sha).toBe('abcdef0123456789abcdef0123456789abcdef01');
    expect(info.git_sha_source).toBe('build-info');
    expect(info.built_at).toBe('2026-09-27T12:00:00.000Z');
    expect(info.git_branch).toBe('main');
    expect(info.tool_count).toBe(2);
    expect(info.tools).toEqual(['get_day', 'get_server_info']);
    expect(info.process_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(info.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it('falls back to RENDER_GIT_COMMIT when no build-info file', () => {
    process.env.RENDER_GIT_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.RENDER_SERVICE_NAME = 'flops-api';
    const info = getServerInfo({ tools: ['x'] });
    expect(info.git_sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(info.git_sha_source).toBe('render');
    expect(info.built_at).toBeNull();
    expect(info.service_name).toBe('flops-api');
  });

  it('/health includes git_sha and process_started_at', async () => {
    process.env.RENDER_GIT_COMMIT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const { app } = buildTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.git_sha).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(res.body.process_started_at).toBeTruthy();
    expect(res.body.tools).toBeUndefined();
  });

  it('MCP get_server_info reports live tool_count matching registry', async () => {
    const prevToken = process.env.MCP_API_TOKEN;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    process.env.RENDER_GIT_COMMIT = 'cccccccccccccccccccccccccccccccccccccccc';

    const { app, db } = buildTestApp();
    createUser(db, 'info@mcp.test');

    // Direct unit check mirrors what the tool handler returns
    const server = createFlopsMcpServer(db, 1);
    const names = Object.keys(server._registeredTools);
    expect(names).toContain('get_server_info');
    const expectedCount = names.length;

    const listed = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.status).toBe(200);
    const listedNames = (listed.body.result?.tools || []).map((t) => t.name);
    expect(listedNames).toContain('get_server_info');
    expect(listedNames).toHaveLength(expectedCount);

    const called = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_server_info', arguments: {} },
      });
    expect(called.status).toBe(200);
    const text = called.body.result?.content?.[0]?.text;
    const payload = JSON.parse(text);
    expect(payload.git_sha).toBe('cccccccccccccccccccccccccccccccccccccccc');
    expect(payload.tool_count).toBe(expectedCount);
    expect(payload.tools).toEqual(expect.arrayContaining(['get_server_info', 'get_day', 'log_meal']));
    expect(payload.process_started_at).toBeTruthy();

    if (prevToken === undefined) delete process.env.MCP_API_TOKEN;
    else process.env.MCP_API_TOKEN = prevToken;
  });

  it('getHealthInfo stays status:ok shaped for Render probes', () => {
    const h = getHealthInfo();
    expect(h.status).toBe('ok');
  });
});
