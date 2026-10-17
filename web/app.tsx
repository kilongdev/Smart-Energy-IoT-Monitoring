import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { io } from 'socket.io-client';
type Row = Record<string, any>;
const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(n || 0);
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'Chưa có';
const getToken = () => sessionStorage.getItem('energy-token');
async function api(path: string, method = 'GET', data?: any) {
  const r = await fetch('/api/v1/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + getToken(),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('energy-logout'));
    throw new Error(
      Array.isArray(value.message)
        ? value.message.join('; ')
        : value.message || 'Yêu cầu thất bại',
    );
  }
  return value;
}
function Icon({ name }: { name: string }) {
  const p: Record<string, string> = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
    alert: 'm12 3 10 18H2z M12 9v5 M12 17v1',
    control: 'M12 2v10 M6 5a9 9 0 1 0 12 0',
    schedule: 'M8 2v4 M16 2v4 M3 10h18 M3 4h18v17H3z M8 14h3 M8 17h6',
    catalog: 'M3 7h18v14H3z M3 7l3-4h12l3 4 M8 12h8',
    logs: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
    energy: 'm13 2-9 12h7l-1 8 10-13h-7z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={p[name] || p.energy} />
    </svg>
  );
}
function Badge({ value }: { value: any }) {
  let cls = ['Thành công', 'Đã xử lý', 'LOW', true].includes(value)
    ? 'good'
    : ['Thất bại', 'HIGH', 'Mới', false].includes(value)
      ? 'bad'
      : 'neutral';
  return (
    <span className={'badge ' + cls}>
      {value === true
        ? 'Online'
        : value === false
          ? 'Offline'
          : value === 'NO_DATA'
            ? 'Chưa có dữ liệu'
            : value}
    </span>
  );
}
function Chart({ option, height = 290 }: { option: any; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = echarts.init(el.current!);
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={el} style={{ height }} />;
}
function Login({ done }: { done: (u: Row) => void }) {
  const [name, setName] = useState('admin'),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: any) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('auth/login', 'POST', {
        tai_khoan: name,
        mat_khau: password,
      });
      sessionStorage.setItem('energy-token', r.access_token);
      done(r.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <div className="brand">
          <Icon name="energy" />
          <span>
            Smart Energy<span className="brand-sub">BUILDING INTELLIGENCE</span>
          </span>
        </div>
        <div>
          <div className="eyebrow">NĂNG LƯỢNG TRONG TẦM KIỂM SOÁT</div>
          <h1>
            Hiểu từng watt.
            <br />
            Chủ động từng giờ.
          </h1>
          <p>
            Theo dõi điện năng, phát hiện bất thường và điều khiển thiết bị trên
            cùng một không gian.
          </p>
          <div className="story-line">
            <span>01 · Giám sát</span>
            <span>02 · Cảnh báo</span>
            <span>03 · Điều khiển</span>
          </div>
        </div>
        <small>SMART ENERGY IOT / NHÓM 19 – 1A</small>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập hệ thống</h2>
          <p className="muted">Sử dụng tài khoản đã được quản trị viên cấp.</p>
          <label>
            Tài khoản
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary wide" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập →'}
          </button>
          <p className="help">
            Mật khẩu lần đầu được tạo bởi lệnh <code>npm run setup</code> trong
            hướng dẫn cài đặt.
          </p>
        </form>
      </section>
    </div>
  );
}
const labels: Record<string, string> = {
  dashboard: 'Tổng quan',
  map: 'Bản đồ nhiệt',
  alert: 'Cảnh báo',
  control: 'Điều khiển',
  schedule: 'Lịch hẹn giờ',
  logs: 'Nhật ký',
  catalog: 'Quản trị',
};
const titles: Record<string, string> = {
  dashboard: 'Năng lượng tòa nhà',
  map: 'Mức tiêu thụ theo không gian',
  alert: 'Cảnh báo & bất thường',
  control: 'Điều khiển thiết bị',
  schedule: 'Tự động theo lịch',
  logs: 'Lịch sử điều khiển',
  catalog: 'Danh mục hệ thống',
};
function App() {
  const [user, setUser] = useState<Row | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [tab, setTab] = useState('dashboard'),
    [connected, setConnected] = useState(false);
  const [data, setData] = useState<Row>({
      devices: [],
      heatmap: [],
      total: 0,
      online: 0,
      totalPowerW: 0,
    }),
    [lists, setLists] = useState<Row>({
      buildings: [],
      floors: [],
      rooms: [],
      devices: [],
      users: [],
    });
  const [alerts, setAlerts] = useState<Row[]>([]),
    [rules, setRules] = useState<Row[]>([]),
    [schedules, setSchedules] = useState<Row[]>([]),
    [logs, setLogs] = useState<Row[]>([]);
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState<any>(null),
    [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(''),
    [selectedDevice, setSelectedDevice] = useState(''),
    [samples, setSamples] = useState<Row[]>([]),
    [energy, setEnergy] = useState<Row[]>([]),
    [period, setPeriod] = useState('day');
  const manager = user && user.vai_tro !== 'NguoiXem';
  const admin = user?.vai_tro === 'Admin';
  const refreshTimer = useRef<any>(null);
  const logout = useCallback(() => {
    sessionStorage.removeItem('energy-token');
    setUser(null);
    setTab('dashboard');
    setDialog(null);
    setBuilding('');
    setSelectedDevice('');
  }, []);
  useEffect(() => {
    window.addEventListener('energy-logout', logout);
    if (getToken())
      api('auth/me')
        .then(setUser)
        .catch(() => {})
        .finally(() => setAuthLoading(false));
    else setAuthLoading(false);
    return () => window.removeEventListener('energy-logout', logout);
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const names = [
        'buildings',
        'floors',
        'rooms',
        'devices',
        ...(admin ? ['users'] : []),
      ];
      const [dash, ...values] = await Promise.all([
        api('dashboard'),
        ...names.map((x) => api(x)),
      ]);
      setData(dash);
      setLists(Object.fromEntries(names.map((n, i) => [n, values[i]])));
      if (manager) {
        const [a, r, s, l] = await Promise.all([
          api('alerts/history'),
          api('alerts/rules'),
          api('control/schedules'),
          api('control/logs'),
        ]);
        setAlerts(a);
        setRules(r);
        setSchedules(s);
        setLogs(l);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [user, admin, manager]);
  useEffect(() => {
    if (!user) return;
    load();
    const timer = setInterval(load, 5000);
    const socket = io({
      transports: ['websocket'],
      auth: { token: getToken() },
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    const update = () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(load, 250);
    };
    socket.on('telemetry', update);
    socket.on('command', update);
    socket.on('alert', (e: any) => {
      setNotice('Cảnh báo mới: ' + (e.message || 'Trạng thái đã cập nhật'));
      update();
    });
    return () => {
      clearInterval(timer);
      clearTimeout(refreshTimer.current);
      socket.disconnect();
    };
  }, [user, load]);
  const visibleDevices = data.devices.filter(
    (d: Row) => !building || d.buildingId === building,
  );
  const deviceId = selectedDevice || visibleDevices[0]?._id;
  useEffect(() => {
    if (!user || !deviceId) return;
    let stop = false;
    async function fetchHistory() {
      try {
        const now = new Date(),
          from = new Date(+now - 15 * 60000);
        const r = await api(
          `telemetry/device/${deviceId}/history?from=${from.toISOString()}&to=${now.toISOString()}`,
        );
        if (!stop) setSamples(r.data);
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    fetchHistory();
    const t = setInterval(fetchHistory, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user, deviceId]);
  useEffect(() => {
    if (!user) return;
    let stop = false;
    async function fetchEnergy() {
      try {
        const end = Math.floor(Date.now() / 3600000) * 3600000;
        const days = period === 'day' ? 7 : period === 'week' ? 28 : 90;
        const r = await api(
          `analytics/energy?from=${new Date(end - days * 86400000).toISOString()}&to=${new Date(end).toISOString()}&period=${period}${building ? '&buildingId=' + building : ''}`,
        );
        if (!stop) setEnergy(r.data);
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    fetchEnergy();
    const t = setInterval(fetchEnergy, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user, building, period]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 7000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function change(
    path: string,
    method: string,
    payload?: any,
    message = 'Đã cập nhật',
  ) {
    setSaving(true);
    setError('');
    try {
      const result = await api(path, method, payload);
      setNotice(
        result.trang_thai === 'Thất bại'
          ? 'Lệnh thất bại: ' + result.loi
          : message,
      );
      setDialog(null);
      await load();
      return result;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setSaving(false);
    }
  }
  const run = (...args: Parameters<typeof change>) =>
    change(...args).catch(() => {});
  const edit = (kind: string, record?: Row) => setDialog({ kind, record });
  if (authLoading)
    return <div className="loading">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <Login done={setUser} />;
  const power = visibleDevices
    .filter((d: Row) => d.online)
    .reduce((s: number, d: Row) => s + (d.latest?.cong_suat_w || 0), 0);
  const selected = visibleDevices.find((d: Row) => d._id === deviceId);
  const chartOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 20, top: 28, bottom: 42 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#cad6d0' } },
      axisLabel: { color: '#7c8983' },
    },
    yAxis: {
      type: 'value',
      name: 'W',
      splitLine: { lineStyle: { color: '#edf1ee' } },
      axisLabel: { color: '#7c8983' },
    },
    series: [
      {
        type: 'line',
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: '#258369', width: 2.5 },
        areaStyle: { color: '#c5e7d7', opacity: 0.45 },
        data: samples.map((s) => [s.thoi_gian_do, s.cong_suat_w]),
      },
    ],
  };
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <Icon name="energy" />
          <span>
            Smart Energy<span className="brand-sub">BUILDING INTELLIGENCE</span>
          </span>
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {Object.entries(labels)
            .filter(([key]) =>
              key === 'catalog'
                ? admin
                : ['alert', 'control', 'schedule', 'logs'].includes(key)
                  ? manager
                  : true,
            )
            .map(([key, text]) => (
              <button
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => setTab(key)}
              >
                <Icon name={key} />
                {text}
                {key === 'alert' &&
                  alerts.some((a) => a.trang_thai === 'Mới') && (
                    <span className="nav-dot" />
                  )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-line">
            <i className={connected ? 'dot live' : 'dot'} />
            {connected ? 'Đang kết nối trực tiếp' : 'Đang kết nối lại'}
          </div>
          <div className="profile">
            <div className="avatar">{user.ho_ten?.slice(0, 1)}</div>
            <div>
              <strong>{user.ho_ten}</strong>
              <small>
                {user.vai_tro === 'Admin'
                  ? 'Quản trị viên'
                  : manager
                    ? 'Quản lý'
                    : 'Người xem'}
              </small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            Đăng xuất ↗
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">
              SMART ENERGY / {labels[tab].toUpperCase()}
            </div>
            <h1>{titles[tab]}</h1>
            <p className="muted">
              {new Date().toLocaleDateString('vi-VN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · Giờ Việt Nam
            </p>
          </div>
          <div className="header-tools">
            <span className="live-label">
              <i className={connected ? 'dot live' : 'dot'} />
              {connected ? 'Trực tiếp' : 'Đang kết nối'}
            </span>
            <a
              className="link-button"
              href="/docs"
              target="_blank"
              rel="noreferrer"
            >
              API Docs ↗
            </a>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice('')}>×</button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}
        <div className="toolbar">
          <div>
            <span className="muted">Phạm vi giám sát</span>
            <select
              value={building}
              onChange={(e) => {
                setBuilding(e.target.value);
                setSelectedDevice('');
              }}
            >
              <option value="">Tất cả tòa nhà được cấp quyền</option>
              {lists.buildings?.map((b: Row) => (
                <option key={b._id} value={b._id}>
                  {b.ten_toa_nha}
                </option>
              ))}
            </select>
          </div>
          <span className="muted small">Cập nhật: {date(data.serverTime)}</span>
        </div>
        {tab === 'dashboard' && (
          <>
            <div className="metrics">
              <Metric
                label="CÔNG SUẤT HIỆN TẠI"
                value={fmt(power / 1000, 2)}
                unit="kW"
                detail="Tổng thiết bị đang online"
                featured
              />
              <Metric
                label="THIẾT BỊ KẾT NỐI"
                value={String(
                  visibleDevices.filter((d: Row) => d.online).length,
                )}
                unit={'/ ' + visibleDevices.length}
                detail="Offline sau 3 chu kỳ không có dữ liệu"
              />
              <Metric
                label="ĐIỆN NĂNG TRONG KỲ"
                value={fmt(
                  energy.reduce((s, x) => s + x.dien_nang_kwh, 0),
                  3,
                )}
                unit="kWh"
                detail={
                  period === 'day'
                    ? '7 ngày, đến đầu giờ hiện tại'
                    : period === 'week'
                      ? '28 ngày, đến đầu giờ hiện tại'
                      : '90 ngày, đến đầu giờ hiện tại'
                }
              />
              <Metric
                label={manager ? 'CẢNH BÁO CHƯA XỬ LÝ' : 'PHÒNG GIÁM SÁT'}
                value={String(
                  manager
                    ? alerts.filter(
                        (x) =>
                          x.trang_thai !== 'Đã xử lý' &&
                          (!building || x.buildingId === building),
                      ).length
                    : data.heatmap.filter(
                        (x: Row) => !building || x.buildingId === building,
                      ).length,
                )}
                unit=""
                detail={
                  manager
                    ? 'Cần kiểm tra và xác nhận'
                    : 'Trong phạm vi tài khoản'
                }
              />
            </div>
            <div className="chart-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Diễn biến công suất</h2>
                    <p className="muted small">
                      Dữ liệu đo trong 15 phút gần nhất
                    </p>
                  </div>
                  <select
                    value={deviceId || ''}
                    onChange={(e) => setSelectedDevice(e.target.value)}
                  >
                    {visibleDevices.map((d: Row) => (
                      <option key={d._id} value={d._id}>
                        {d.ten_thiet_bi}
                      </option>
                    ))}
                  </select>
                </div>
                {samples.length ? (
                  <Chart option={chartOption} />
                ) : (
                  <Empty text="Đang chờ dữ liệu từ thiết bị…" />
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Thông số thiết bị</h2>
                  <Badge value={!!selected?.online} />
                </div>
                <Chart
                  height={200}
                  option={{
                    series: [
                      {
                        type: 'gauge',
                        min: 0,
                        max: selected?.cong_suat_dinh_muc || 2000,
                        progress: {
                          show: true,
                          width: 12,
                          itemStyle: { color: '#2f8b70' },
                        },
                        axisLine: {
                          lineStyle: { width: 12, color: [[1, '#edf2ee']] },
                        },
                        splitLine: { show: false },
                        axisTick: { show: false },
                        axisLabel: { show: false },
                        pointer: { show: false },
                        anchor: { show: false },
                        detail: {
                          fontSize: 25,
                          color: '#183b30',
                          formatter: '{value} W',
                          offsetCenter: [0, '10%'],
                        },
                        title: { show: false },
                        data: [
                          {
                            value: Math.round(
                              selected?.latest?.cong_suat_w || 0,
                            ),
                          },
                        ],
                      },
                    ],
                  }}
                />
                <div className="readings">
                  <span>
                    Điện áp
                    <strong>
                      {fmt(selected?.latest?.dien_ap_v, 1)} <small>V</small>
                    </strong>
                  </span>
                  <span>
                    Dòng điện
                    <strong>
                      {fmt(selected?.latest?.dong_dien_a, 2)} <small>A</small>
                    </strong>
                  </span>
                  <span>
                    Nhiệt độ
                    <strong>
                      {fmt(selected?.latest?.nhiet_do_c, 1)} <small>°C</small>
                    </strong>
                  </span>
                </div>
                <p className="muted small">
                  Đo lúc: {date(selected?.latest?.thoi_gian_do)}
                </p>
              </section>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Điện năng tiêu thụ</h2>
                  <p className="muted small">
                    Tổng hợp theo giờ · Không nội suy khoảng mất kết nối dài
                  </p>
                </div>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="day">Theo ngày · 7 ngày</option>
                  <option value="week">Theo tuần · 28 ngày</option>
                  <option value="month">Theo tháng · 90 ngày</option>
                </select>
              </div>
              {energy.length ? (
                <Chart
                  height={240}
                  option={{
                    tooltip: { trigger: 'axis' },
                    grid: { left: 55, right: 20, top: 25, bottom: 35 },
                    xAxis: {
                      type: 'category',
                      data: energy.map((x) =>
                        new Date(x._id).toLocaleDateString('vi-VN'),
                      ),
                    },
                    yAxis: {
                      type: 'value',
                      name: 'kWh',
                      splitLine: { lineStyle: { color: '#edf1ee' } },
                    },
                    series: [
                      {
                        type: 'bar',
                        barMaxWidth: 34,
                        itemStyle: {
                          color: '#43967a',
                          borderRadius: [5, 5, 0, 0],
                        },
                        data: energy.map((x) => +x.dien_nang_kwh.toFixed(4)),
                      },
                    ],
                  }}
                />
              ) : (
                <Empty text="Chưa có dữ liệu tổng hợp. Biểu đồ kỳ này chỉ tính các giờ đã kết thúc." />
              )}
            </section>
          </>
        )}
        {tab === 'map' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Bản đồ nhiệt theo phòng</h2>
                <p className="muted">
                  Màu theo tỷ lệ công suất hiện tại / tổng công suất định mức
                </p>
              </div>
              <div className="legend">
                <span>● &lt;50%</span>
                <span>● 50–80%</span>
                <span>● &gt;80%</span>
              </div>
            </div>
            <div className="heatmap">
              {data.heatmap
                .filter((r: Row) => !building || r.buildingId === building)
                .map((r: Row) => (
                  <article
                    key={r.ma_phong}
                    className={'heat ' + r.muc_do_canh_bao}
                  >
                    <div>
                      {r.ten_phong}
                      <small>
                        Tầng{' '}
                        {
                          lists.floors?.find((f: Row) => f._id === r.ma_tang)
                            ?.so_tang
                        }
                      </small>
                    </div>
                    <strong>
                      {fmt(r.tong_cong_suat_w / 1000, 2)} <small>kW</small>
                    </strong>
                    <span>
                      {r.online}/{r.total} thiết bị online
                    </span>
                  </article>
                ))}
            </div>
          </section>
        )}
        {tab === 'control' && (
          <>
            <p className="info-text">
              Lệnh chuyển sang “Thành công” sau khi thiết bị xác nhận. Nếu quá 5
              giây chưa có ACK, lệnh thất bại; kiểm tra nhật ký để biết nguyên
              nhân.
            </p>
            <div className="device-grid">
              {visibleDevices.map((d: Row) => (
                <section className="panel device" key={d._id}>
                  <div className="panel-head">
                    <span className="device-icon">
                      <Icon name="control" />
                    </span>
                    <Badge value={d.online} />
                  </div>
                  <h2>{d.ten_thiet_bi}</h2>
                  <p className="muted">
                    {
                      lists.rooms?.find((r: Row) => r._id === d.ma_phong)
                        ?.ten_phong
                    }
                  </p>
                  <div className="device-power">
                    {fmt(d.latest?.cong_suat_w)} <small>W</small>
                  </div>
                  <div className="device-state">
                    Relay báo về:{' '}
                    <strong>
                      {d.trang_thai_relay === undefined
                        ? 'Chưa có'
                        : d.trang_thai_relay
                          ? 'Bật'
                          : 'Tắt'}
                    </strong>
                  </div>
                  {d.pendingCommand ? (
                    <p className="pending">Đang chờ phản hồi thiết bị…</p>
                  ) : (
                    <div className="button-row">
                      <button
                        disabled={!d.online || !d.cho_phep_dieu_khien || saving}
                        onClick={() =>
                          run(
                            `control/devices/${d._id}/switch`,
                            'POST',
                            { hanh_dong: 'Bật' },
                            'Đã tạo lệnh Bật; đang chờ ACK',
                          )
                        }
                      >
                        Bật
                      </button>
                      <button
                        disabled={!d.online || !d.cho_phep_dieu_khien || saving}
                        onClick={() =>
                          run(
                            `control/devices/${d._id}/switch`,
                            'POST',
                            { hanh_dong: 'Tắt' },
                            'Đã tạo lệnh Tắt; đang chờ ACK',
                          )
                        }
                      >
                        Tắt
                      </button>
                    </div>
                  )}
                </section>
              ))}
            </div>
            {!visibleDevices.length && (
              <Empty text="Chưa có thiết bị trong phạm vi này" />
            )}
          </>
        )}
        {tab === 'alert' && (
          <AlertPage
            alerts={alerts.filter(
              (a) => !building || a.buildingId === building,
            )}
            rules={rules.filter((a) => !building || a.buildingId === building)}
            devices={data.devices}
            edit={edit}
            run={run}
            saving={saving}
          />
        )}
        {tab === 'schedule' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Lịch điều khiển</h2>
                <p className="muted small">
                  Mỗi lịch thực hiện một hành động · Múi giờ Asia/Ho_Chi_Minh
                </p>
              </div>
              <button className="primary" onClick={() => edit('schedules')}>
                + Thêm lịch
              </button>
            </div>
            <Table
              heads={[
                'Thiết bị',
                'Hành động',
                'Giờ',
                'Ngày lặp',
                'Trạng thái',
                'Thao tác',
              ]}
              rows={schedules
                .filter((s) => !building || s.buildingId === building)
                .map((s) => [
                  data.devices.find((d: Row) => d._id === s.ma_thiet_bi)
                    ?.ten_thiet_bi,
                  s.hanh_dong,
                  s.gio_bat_dau,
                  s.ngay_lap_lai,
                  <Badge value={s.bat ? 'Đang bật' : 'Đang tắt'} />,
                  <div className="actions">
                    <button onClick={() => edit('schedules', s)}>Sửa</button>
                    <button
                      onClick={() =>
                        run('control/schedules/' + s._id, 'PATCH', {
                          bat: !s.bat,
                        })
                      }
                    >
                      {s.bat ? 'Tạm dừng' : 'Kích hoạt'}
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        confirm('Xóa lịch hẹn giờ này?') &&
                        run('control/schedules/' + s._id, 'DELETE')
                      }
                    >
                      Xóa
                    </button>
                  </div>,
                ])}
            />
          </section>
        )}
        {tab === 'logs' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Nhật ký lệnh</h2>
                <p className="muted small">
                  Tối đa 500 lệnh gần nhất · Trạng thái lấy từ phản hồi thiết bị
                </p>
              </div>
            </div>
            <Table
              heads={[
                'Thời điểm',
                'Thiết bị',
                'Lệnh',
                'Nguồn',
                'Kết quả',
                'Chi tiết',
              ]}
              rows={logs
                .filter((l) => !building || l.buildingId === building)
                .map((l) => [
                  date(l.thoi_gian_thuc_hien),
                  data.devices.find((d: Row) => d._id === l.ma_thiet_bi)
                    ?.ten_thiet_bi || l.ma_thiet_bi,
                  l.hanh_dong,
                  l.nguon,
                  <Badge value={l.trang_thai} />,
                  l.loi ||
                    (l.lateAck
                      ? 'Có ACK đến muộn'
                      : l.ack
                        ? 'Đã đối chiếu ACK'
                        : 'Đang chờ'),
                ])}
            />
          </section>
        )}
        {tab === 'catalog' && (
          <CatalogPage lists={lists} edit={edit} run={run} />
        )}
        <footer>
          SMART ENERGY IOT <span>Giám sát · Cảnh báo · Điều khiển</span>
        </footer>
      </main>
      {dialog && (
        <Editor
          kind={dialog.kind}
          record={dialog.record}
          lists={lists}
          busy={saving}
          error={error}
          close={() => {
            setDialog(null);
            setError('');
          }}
          save={(payload: any) =>
            change(
              (dialog.kind === 'rules'
                ? 'alerts/rules'
                : dialog.kind === 'schedules'
                  ? 'control/schedules'
                  : dialog.kind) +
                (dialog.record ? '/' + dialog.record._id : ''),
              dialog.record ? 'PATCH' : 'POST',
              payload,
              'Đã lưu dữ liệu',
            )
          }
        />
      )}
    </div>
  );
}
function Metric({ label, value, unit, detail, featured = false }: any) {
  return (
    <section className={'metric ' + (featured ? 'featured' : '')}>
      <div className="metric-label">{label}</div>
      <div className="metric-number">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function Empty({ text }: any) {
  return <div className="empty">{text}</div>;
}
function Table({ heads, rows }: any) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {heads.map((h: string) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any[], i: number) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td key={j}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="Chưa có dữ liệu phù hợp" />
  );
}
function AlertPage({ alerts, rules, devices, edit, run, saving }: any) {
  const [status, setStatus] = useState(''),
    [severity, setSeverity] = useState(''),
    [room, setRoom] = useState(''),
    [since, setSince] = useState('');
  const rooms = [...new Set<string>(devices.map((d: Row) => d.ma_phong))];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Sự cố cần theo dõi</h2>
            <p className="muted small">Mới → Đã xác nhận → Đã xử lý</p>
          </div>
        </div>
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {['Mới', 'Đã xác nhận', 'Đã xử lý'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">Tất cả mức độ</option>
            {['LOW', 'MEDIUM', 'HIGH'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Tất cả phòng</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {devices.find((d: Row) => d.ma_phong === r)?.ten_thiet_bi}
              </option>
            ))}
          </select>
          <label className="inline-label">
            Từ ngày
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </label>
        </div>
        <Table
          heads={[
            'Thời điểm',
            'Nội dung',
            'Mức độ',
            'Xử lý',
            'Telegram',
            'Thao tác',
          ]}
          rows={alerts
            .filter(
              (a: Row) =>
                (!status || a.trang_thai === status) &&
                (!severity || a.muc_do === severity) &&
                (!room || a.ma_phong === room) &&
                (!since || new Date(a.thoi_gian_phat_hien) >= new Date(since)),
            )
            .map((a: Row) => [
              date(a.thoi_gian_phat_hien),
              <span className="wrap">
                {a.noi_dung_loi}
                <small>{a.occurrences} lần ghi nhận</small>
              </span>,
              <Badge value={a.muc_do} />,
              <Badge value={a.trang_thai} />,
              a.trang_thai_gui,
              a.trang_thai !== 'Đã xử lý' ? (
                <button
                  disabled={saving}
                  onClick={() => {
                    const note =
                      a.trang_thai === 'Đã xác nhận'
                        ? prompt('Ghi chú kết quả xử lý:')
                        : '';
                    if (note === null) return;
                    run(`alerts/history/${a._id}/status`, 'PATCH', {
                      trang_thai:
                        a.trang_thai === 'Mới' ? 'Đã xác nhận' : 'Đã xử lý',
                      ghi_chu: note,
                    });
                  }}
                >
                  {a.trang_thai === 'Mới' ? 'Xác nhận' : 'Đã xử lý'}
                </button>
              ) : (
                'Hoàn tất'
              ),
            ])}
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Quy tắc cảnh báo</h2>
            <p className="muted small">
              Chỉ phát cảnh báo khi vi phạm đủ thời gian duy trì
            </p>
          </div>
          <button className="primary" onClick={() => edit('rules')}>
            + Thêm quy tắc
          </button>
        </div>
        <Table
          heads={[
            'Tên quy tắc',
            'Điều kiện',
            'Duy trì',
            'Cooldown',
            'Trạng thái',
            'Thao tác',
          ]}
          rows={rules.map((r: Row) => [
            r.ten_quy_tac,
            `${r.chi_so_can_do} ${r.toan_tu} ${r.gia_tri_nguong}`,
            r.thoi_gian_duy_tri + ' giây',
            r.cooldown + ' giây',
            r.bat ? 'Đang bật' : 'Tạm dừng',
            <div className="actions">
              <button onClick={() => edit('rules', r)}>Sửa</button>
              <button
                onClick={() =>
                  run('alerts/rules/' + r._id, 'PATCH', { bat: !r.bat })
                }
              >
                {r.bat ? 'Tắt' : 'Bật'}
              </button>
            </div>,
          ])}
        />
      </section>
    </>
  );
}
const kindLabels: Record<string, string> = {
  buildings: 'Tòa nhà',
  floors: 'Tầng',
  rooms: 'Phòng',
  devices: 'Thiết bị',
  users: 'Tài khoản',
  rules: 'Quy tắc cảnh báo',
  schedules: 'Lịch hẹn giờ',
};
function CatalogPage({ lists, edit, run }: any) {
  const [kind, setKind] = useState('buildings');
  const fields: Record<string, string[]> = {
    buildings: ['ten_toa_nha', 'dia_chi'],
    floors: ['so_tang', 'ma_toa_nha'],
    rooms: ['ten_phong', 'loai_phong'],
    devices: ['ten_thiet_bi', 'chu_de_mqtt', 'chu_ky_gui'],
    users: ['tai_khoan', 'ho_ten', 'vai_tro'],
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="tabs">
          {Object.keys(fields).map((k) => (
            <button
              className={kind === k ? 'selected' : ''}
              onClick={() => setKind(k)}
              key={k}
            >
              {kindLabels[k]}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => edit(kind)}>
          + Thêm {kindLabels[kind].toLowerCase()}
        </button>
      </div>
      <Table
        heads={[
          ...fields[kind].map(
            (k) =>
              (
                ({
                  ten_toa_nha: 'Tên tòa nhà',
                  dia_chi: 'Địa chỉ',
                  so_tang: 'Số tầng',
                  ma_toa_nha: 'Tòa nhà',
                  ten_phong: 'Tên phòng',
                  loai_phong: 'Loại phòng',
                  ten_thiet_bi: 'Tên thiết bị',
                  chu_de_mqtt: 'MQTT topic',
                  chu_ky_gui: 'Chu kỳ (giây)',
                  tai_khoan: 'Tài khoản',
                  ho_ten: 'Họ tên',
                  vai_tro: 'Vai trò',
                }) as any
              )[k],
          ),
          'Thao tác',
        ]}
        rows={(lists[kind] || []).map((r: Row) => [
          ...fields[kind].map((k) =>
            k === 'ma_toa_nha'
              ? lists.buildings.find((b: Row) => b._id === r[k])?.ten_toa_nha
              : r[k],
          ),
          <div className="actions">
            <button onClick={() => edit(kind, r)}>Sửa</button>
            <button
              className="danger"
              onClick={() =>
                confirm(
                  kind === 'users'
                    ? 'Khóa tài khoản này?'
                    : 'Xóa đối tượng này? Đối tượng có lịch sử sẽ không bị xóa.',
                ) && run(kind + '/' + r._id, 'DELETE')
              }
            >
              {kind === 'users' ? 'Khóa' : 'Xóa'}
            </button>
          </div>,
        ])}
      />
    </section>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  min?: number;
  max?: number;
  step?: string;
  hint?: string;
  fixed?: boolean;
};
function Editor({ kind, record, lists, busy, error, close, save }: any) {
  const opts = (k: string, label: string) =>
    (lists[k] || []).map((r: Row) => ({
      value: r._id,
      label: String(r[label]),
    }));
  const values = (a: string[]) => a.map((v) => ({ value: v, label: v }));
  const deviceField = {
    key: 'ma_thiet_bi',
    label: 'Thiết bị',
    options: opts('devices', 'ten_thiet_bi'),
  };
  const definitions: Record<string, Field[]> = {
    buildings: [
      { key: 'ten_toa_nha', label: 'Tên tòa nhà' },
      { key: 'dia_chi', label: 'Địa chỉ', optional: true },
    ],
    floors: [
      {
        key: 'ma_toa_nha',
        label: 'Tòa nhà',
        options: opts('buildings', 'ten_toa_nha'),
        fixed: true,
      },
      { key: 'so_tang', label: 'Số tầng', type: 'number', min: -10, max: 200 },
    ],
    rooms: [
      {
        key: 'ma_tang',
        label: 'Tầng',
        options: (lists.floors || []).map((f: Row) => ({
          value: f._id,
          label:
            (lists.buildings.find((b: Row) => b._id === f.ma_toa_nha)
              ?.ten_toa_nha || '') +
            ' / Tầng ' +
            f.so_tang,
        })),
        fixed: true,
      },
      { key: 'ten_phong', label: 'Tên phòng' },
      {
        key: 'loai_phong',
        label: 'Loại phòng',
        options: values(['CLASSROOM', 'OFFICE', 'LAB', 'MEETING', 'OTHER']),
      },
    ],
    devices: [
      {
        key: 'ma_phong',
        label: 'Phòng',
        options: opts('rooms', 'ten_phong'),
        fixed: true,
      },
      { key: 'ten_thiet_bi', label: 'Tên thiết bị' },
      { key: 'dia_chi_mac', label: 'Địa chỉ MAC', hint: 'AA:BB:CC:DD:EE:FF' },
      {
        key: 'chu_de_mqtt',
        label: 'MQTT topic gốc',
        hint: 'campus/building_a/device_01',
        fixed: true,
      },
      {
        key: 'cong_suat_dinh_muc',
        label: 'Công suất định mức (W)',
        type: 'number',
        min: 1,
        max: 10000000,
      },
      {
        key: 'chu_ky_gui',
        label: 'Chu kỳ gửi (giây)',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'cho_phep_dieu_khien',
        label: 'Hỗ trợ điều khiển relay',
        type: 'checkbox',
      },
    ],
    users: [
      { key: 'tai_khoan', label: 'Tài khoản' },
      { key: 'ho_ten', label: 'Họ tên' },
      {
        key: 'mat_khau',
        label: record ? 'Mật khẩu mới (để trống để giữ nguyên)' : 'Mật khẩu',
        type: 'password',
        optional: !!record,
      },
      {
        key: 'vai_tro',
        label: 'Vai trò',
        options: values(['Admin', 'QuanLy', 'NguoiXem']),
      },
      {
        key: 'buildingIds',
        label: 'Tòa nhà được truy cập',
        type: 'multiple',
        options: opts('buildings', 'ten_toa_nha'),
        optional: true,
        hint: 'Giữ Ctrl để chọn nhiều; Admin có quyền trên mọi tòa nhà',
      },
      { key: 'active', label: 'Tài khoản hoạt động', type: 'checkbox' },
    ],
    rules: [
      { key: 'ten_quy_tac', label: 'Tên quy tắc' },
      deviceField,
      {
        key: 'chi_so_can_do',
        label: 'Thông số',
        options: values([
          'cong_suat_w',
          'dien_ap_v',
          'dong_dien_a',
          'nhiet_do_c',
        ]),
      },
      {
        key: 'toan_tu',
        label: 'Điều kiện',
        options: values(['>', '<', '>=', '<=', '=']),
      },
      { key: 'gia_tri_nguong', label: 'Ngưỡng', type: 'number', step: 'any' },
      {
        key: 'khung_gio_ap_dung',
        label: 'Khung giờ áp dụng (tùy chọn)',
        optional: true,
        hint: '22:00-06:00; để trống để áp dụng cả ngày',
      },
      {
        key: 'thoi_gian_duy_tri',
        label: 'Thời gian duy trì (giây)',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cooldown',
        label: 'Khoảng chờ gửi lại (giây)',
        type: 'number',
        min: 5,
        max: 604800,
      },
      {
        key: 'muc_do',
        label: 'Mức độ',
        options: values(['LOW', 'MEDIUM', 'HIGH']),
      },
      { key: 'bat', label: 'Bật quy tắc', type: 'checkbox' },
    ],
    schedules: [
      deviceField,
      { key: 'hanh_dong', label: 'Hành động', options: values(['Bật', 'Tắt']) },
      {
        key: 'gio_bat_dau',
        label: 'Giờ thực hiện (giờ Việt Nam)',
        type: 'time',
        step: '1',
      },
      {
        key: 'ngay_lap_lai',
        label: 'Ngày lặp lại',
        hint: 'T2,T3,T4,T5,T6 hoặc T7,CN',
      },
      { key: 'bat', label: 'Bật lịch hẹn giờ', type: 'checkbox' },
    ],
  };
  const [form, setForm] = useState<Row>(() => ({
    ...{
      cong_suat_dinh_muc: 2000,
      chu_ky_gui: 5,
      cho_phep_dieu_khien: true,
      active: true,
      buildingIds: [],
      bat: true,
      thoi_gian_duy_tri: 10,
      cooldown: 60,
      gia_tri_nguong: 1000,
      muc_do: 'HIGH',
      hanh_dong: 'Tắt',
      ngay_lap_lai: 'T2,T3,T4,T5,T6',
      chi_so_can_do: 'cong_suat_w',
      toan_tu: '>',
      loai_phong: 'CLASSROOM',
      vai_tro: 'NguoiXem',
    },
    ...record,
  }));
  async function submit(e: any) {
    e.preventDefault();
    const payload: Row = {};
    for (const f of definitions[kind]) {
      let v = form[f.key];
      if (f.optional && (v === '' || v === undefined)) {
        if (record && f.key === 'khung_gio_ap_dung') payload[f.key] = null;
        continue;
      }
      payload[f.key] =
        f.type === 'number' ? Number(v) : f.type === 'checkbox' ? !!v : v;
    }
    try {
      await save(payload);
    } catch {}
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={kindLabels[kind]}
      >
        <div className="panel-head">
          <h2>
            {record ? 'Chỉnh sửa' : 'Thêm'} {kindLabels[kind].toLowerCase()}
          </h2>
          <button aria-label="Đóng" onClick={close}>
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            {definitions[kind].map((f) => (
              <label
                key={f.key}
                className={f.type === 'checkbox' ? 'checkbox-label' : ''}
              >
                {f.type === 'checkbox' ? (
                  <>
                    <input
                      type="checkbox"
                      checked={!!form[f.key]}
                      onChange={(e) =>
                        setForm({ ...form, [f.key]: e.target.checked })
                      }
                    />
                    {f.label}
                  </>
                ) : (
                  <>
                    {f.label}
                    {f.options ? (
                      <select
                        required={!f.optional}
                        multiple={f.type === 'multiple'}
                        disabled={!!record && f.fixed}
                        value={form[f.key] ?? (f.type === 'multiple' ? [] : '')}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            [f.key]:
                              f.type === 'multiple'
                                ? Array.from(e.target.selectedOptions).map(
                                    (o) => o.value,
                                  )
                                : e.target.value,
                          })
                        }
                      >
                        {f.type !== 'multiple' && (
                          <option value="">Chọn…</option>
                        )}
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={!f.optional}
                        disabled={!!record && f.fixed}
                        type={f.type || 'text'}
                        value={form[f.key] ?? ''}
                        onChange={(e) =>
                          setForm({ ...form, [f.key]: e.target.value })
                        }
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        autoComplete={
                          f.type === 'password' ? 'new-password' : 'off'
                        }
                      />
                    )}
                  </>
                )}
                {f.hint && <small className="muted">{f.hint}</small>}
              </label>
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={close}>
              Hủy
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
