'use strict';

const CONFIG = Object.freeze({
    endpoint: 'optimized_cf_ips.txt',
    columns: ['IP:PORT', 'COUNTRY', 'COLO', 'LATENCY', 'LOSS', 'DOWNLOAD', 'SCORE'],
});

const tableBody = document.getElementById('tableBody');
const syncStatus = document.getElementById('syncStatus');
const retryBlock = document.getElementById('retryBlock');
const toast = document.getElementById('toast');
const wildcardHost = document.getElementById('wildcardHost');
const sourceTimestamp = document.getElementById('sourceTimestamp');
const bestLatency = document.getElementById('bestLatency');
const bestLatencyDetail = document.getElementById('bestLatencyDetail');
const peakDownload = document.getElementById('peakDownload');
const peakDownloadDetail = document.getElementById('peakDownloadDetail');
const edgeCoverage = document.getElementById('edgeCoverage');
const edgeCoverageDetail = document.getElementById('edgeCoverageDetail');
const WILDCARD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_WILDCARD_HOST = '*.cdn.fiatnorm.us.kg:443';
const WILDCARD_VISIBLE_MS = 3200;
let wildcardResetTimer;
let activeLoadController;

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function createWildcardHost() {
    const length = 4 + Math.floor(Math.random() * 3);
    const label = Array.from({ length }, () => WILDCARD_CHARS[Math.floor(Math.random() * WILDCARD_CHARS.length)]).join('');
    const host = `${label}.cdn.fiatnorm.us.kg:443`;
    wildcardHost.textContent = host;
    clearTimeout(wildcardResetTimer);
    wildcardResetTimer = setTimeout(() => {
        wildcardHost.textContent = DEFAULT_WILDCARD_HOST;
    }, WILDCARD_VISIBLE_MS);
    return host;
}

function renderLoading() {
    tableBody.innerHTML = Array.from({ length: 4 }, () => `<tr class="skeleton-row">${CONFIG.columns.map(() => '<td><span class="skeleton"></span></td>').join('')}</tr>`).join('');
}

function parseData(payload) {
    const lines = payload.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const timestamp = lines.find(line => line.startsWith('## ExecutionTime:'));
    const rows = lines.filter(line => !line.startsWith('#')).map(line => {
        const match = line.match(/^([^#\s]+)#\s*([A-Z]{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
        if (!match) return null;
        const [, ipPort, country, colo, latency, loss, speed, score] = match;
        return { ipPort, country, colo, latency, loss, speed, score };
    }).filter(Boolean);
    if (!rows.length) throw new Error('No valid IP records were found.');
    return { timestamp: timestamp?.replace('## ExecutionTime:', '').trim(), rows };
}

function renderRows(rows) {
    tableBody.innerHTML = rows.map((row, index) => `<tr style="--row-index:${index}">
        <td data-label="IP:PORT"><button class="ip-copy" data-copy="${escapeHtml(row.ipPort)}">${escapeHtml(row.ipPort)}</button></td>
        <td data-label="COUNTRY"><span class="country-code">${escapeHtml(row.country)}</span></td>
        <td data-label="COLO"><span class="colo">${escapeHtml(row.colo)}</span></td>
        <td data-label="LATENCY"><strong class="latency">${escapeHtml(row.latency)}</strong></td>
        <td data-label="LOSS">${escapeHtml(row.loss)}</td>
        <td data-label="DOWNLOAD"><strong>${escapeHtml(row.speed)}</strong></td>
        <td data-label="SCORE"><span class="score">${escapeHtml(row.score)}</span></td>
    </tr>`).join('');
}

function metricNumber(value) {
    return Number.parseFloat(String(value).replace(/[^\d.]/g, ''));
}

function renderSummary(rows, timestamp) {
    const quickest = rows.reduce((best, row) => metricNumber(row.latency) < metricNumber(best.latency) ? row : best);
    const fastest = rows.reduce((best, row) => metricNumber(row.speed) > metricNumber(best.speed) ? row : best);
    const countries = new Set(rows.map(row => row.country));
    const colos = new Set(rows.map(row => row.colo));

    bestLatency.textContent = quickest.latency;
    bestLatencyDetail.textContent = `${quickest.country} · ${quickest.colo}`;
    peakDownload.textContent = fastest.speed;
    peakDownloadDetail.textContent = `${fastest.country} · ${fastest.colo}`;
    edgeCoverage.textContent = `${colos.size} locations`;
    edgeCoverageDetail.textContent = `${countries.size} country codes · ${rows.length} nodes`;
    sourceTimestamp.textContent = timestamp ? `Source time · ${timestamp}` : 'Live source data';
}

async function loadData() {
    activeLoadController?.abort();
    const controller = new AbortController();
    activeLoadController = controller;
    renderLoading();
    retryBlock.hidden = true;
    syncStatus.textContent = 'Loading nodes…';
    try {
        const response = await fetch(CONFIG.endpoint, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed (HTTP ${response.status})`);
        const { timestamp, rows } = parseData(await response.text());
        if (controller.signal.aborted) return;
        renderRows(rows);
        renderSummary(rows, timestamp);
        syncStatus.textContent = `${rows.length} active nodes`;
    } catch (error) {
        if (error.name === 'AbortError') return;
        tableBody.innerHTML = `<tr><td class="empty-state" colspan="7">Unable to load optimized IPs. ${escapeHtml(error.message)}</td></tr>`;
        syncStatus.textContent = 'Load failed';
        sourceTimestamp.textContent = 'Source data unavailable';
        retryBlock.hidden = false;
    } finally {
        if (activeLoadController === controller) activeLoadController = undefined;
    }
}

async function copyText(value) {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        document.execCommand('copy');
        input.remove();
    }
    showToast(`Copied: ${value}`);
}

document.addEventListener('click', event => {
    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) copyText(copyButton.dataset.copy);
    if (event.target.closest('[data-wildcard-copy]')) copyText(createWildcardHost());
    if (event.target.closest('[data-wildcard-test]')) {
        const host = createWildcardHost();
        window.open(`https://www.tcptest.cn/tcping/${host}`, '_blank', 'noopener,noreferrer');
    }
    if (event.target.closest('[data-retry]')) loadData();
});

renderLoading();
loadData();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
