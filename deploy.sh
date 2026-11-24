#!/usr/bin/env bash
set -euo pipefail

fail() { printf '部署失败：%s\n' "$*" >&2; exit 1; }

preset= data_dir= config_dir= service=
while (( $# )); do
  (( $# >= 2 )) || fail "参数 $1 缺少值"
  case "$1" in
    --preset) preset=$2 ;;
    --data-dir) data_dir=$2 ;;
    --config-dir) config_dir=$2 ;;
    --service) service=$2 ;;
    *) fail "未知参数 $1" ;;
  esac
  shift 2
done
[[ $preset == scenario && $service =~ ^axon-[a-zA-Z0-9_-]+\.service$ ]] ||
  fail '请指定 --preset scenario 和独立的 --service axon-*.service'
for path in "$data_dir" "$config_dir"; do
  [[ $path =~ ^(/[[:alnum:]_-][[:alnum:]_.-]*)+$ ]] || fail '数据与配置目录须为规范的绝对路径'
  [[ $(realpath -m -- "$path") == "$path" ]] || fail '数据与配置目录不得经过符号链接'
done
[[ $data_dir == */data && $config_dir != "$data_dir" && $config_dir != "$data_dir/"* ]] ||
  fail '数据目录须为实例根下的 data，私有配置须独立存放'
[[ $(id -u) != 0 ]] || fail '请用 Axon 服务账号执行，systemd 操作会使用 sudo'

root=${data_dir%/data}
[[ -n $root ]] || fail '需要独立的实例根目录'
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node_bin=$(command -v node) || fail '需要 Node.js 24'
[[ $node_bin =~ ^/[[:alnum:]_./-]+$ ]] || fail '需要绝对且不含空格的 Node.js 路径'
"$node_bin" -e 'process.exit(process.versions.node.startsWith("24.") ? 0 : 1)' || fail '需要 Node.js 24'
[[ -f $config_dir/instance.env && ! -L $config_dir/instance.env ]] || fail "缺少 $config_dir/instance.env"
[[ $(stat -c '%a' -- "$config_dir/instance.env") == 600 ]] || fail 'instance.env 的权限须为 0600'
mkdir -p -- "$root/releases"
exec 9>"$root/.deploy.lock"
flock -n 9 || fail '此实例已有部署进行中'
current=$root/current
[[ ! -e $current || -L $current ]] || fail 'current 必须是发布版本的符号链接'
prior=$(readlink "$current" || true)
revision=$(git -C "$source_root" rev-parse HEAD)
release=$(mktemp -d "$root/releases/${revision:0:12}-XXXXXXXX")
candidate_link=$release/current-link
switched=false
service_stopped=false
finished=false
cleanup() {
  if [[ $finished == false && $switched == true ]]; then
    sudo systemctl stop "$service" || true
    if [[ -n $prior ]]; then
      ln -sfn -- "$prior" "$candidate_link"
      mv -Tf -- "$candidate_link" "$current"
    else
      rm -f -- "$current"
    fi
  fi
  if [[ $finished == false && $service_stopped == true && -n $prior ]]; then
    sudo systemctl start "$service" || printf '请检查原服务的恢复状态。\n' >&2
  fi
}
trap cleanup EXIT

# Build from the selected commit so configuration and code share one release.
git -C "$source_root" archive "$revision" | tar -xf - -C "$release"
app=$release/experiments/harness-lab
cd "$app"
npm ci
npm run build

# Use the application's parser for default execution settings and instance port.
# Keep the environment consistent with the generated systemd unit.
instance_node() {
  env -i HOME="$HOME" PATH="$PATH" "$node_bin" --env-file="$config_dir/instance.env" "$@"
}
port=$(instance_node --import tsx scripts/deploy-preflight.ts) || fail '实例配置或执行沙盒检查失败'
mkdir -p -- "$release/release"
touch -- "$release/release/.managed-deployment"

# An instance name is bound to its own data and private configuration. Refuse
# to replace existing systemd configuration owned by another deployment.
unit=$release/$service
cat >"$unit" <<UNIT
[Unit]
Description=Axon $service
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$current/experiments/harness-lab
ExecStart=$node_bin --env-file=$config_dir/instance.env --env-file=$config_dir/auth.env --import tsx src/server/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
unit_path=/etc/systemd/system/$service
if [[ $(systemctl show -p LoadState --value "$service") == not-found ]]; then
  sudo install -m 0644 -- "$unit" "$unit_path"
  sudo systemctl daemon-reload
else
  [[ $(systemctl show -p FragmentPath --value "$service") == "$unit_path" ]] &&
    cmp -s -- "$unit" "$unit_path" || fail "服务 $service 已配置，须核对其目录、环境及服务账号"
fi

if systemctl is-active --quiet "$service"; then
  [[ -n $prior ]] || fail '服务正在运行但没有可恢复的 current 发布链接'
  sudo systemctl stop "$service"
  service_stopped=true
fi
instance_node --import tsx scripts/deploy-init.ts \
  --preset "$preset" --data-dir "$data_dir" --config-dir "$config_dir" --service-stopped

ln -s -- "$release" "$candidate_link"
mv -Tf -- "$candidate_link" "$current"
switched=true
sudo systemctl start "$service"
base=http://127.0.0.1:$port
curl -fsS --noproxy "*" --retry 15 --retry-connrefused --retry-delay 1 --max-time 5 "$base/api/health" |
  "$node_bin" -e 'const body = JSON.parse(require("node:fs").readFileSync(0,"utf8")); if (body.ok !== true) process.exit(1)'
curl -fsS --noproxy "*" --max-time 5 "$base/api/auth/session" |
  "$node_bin" -e '
    const body = JSON.parse(require("node:fs").readFileSync(0,"utf8"));
    const { seats } = require("./fixtures/seat-deployment.scenario.example.json");
    const expected = seats.filter(seat => seat.type !== "administrator").map(seat => [seat.id, seat.name]).sort();
    const actual = body.loginSeats?.map(seat => [seat.id, seat.name]).sort();
    const administrator = seats.find(seat => seat.type === "administrator");
    if (JSON.stringify(expected) !== JSON.stringify(actual) || body.loginUsers?.length !== 1
      || body.loginUsers[0].name !== administrator.name) process.exit(1);
  '
systemctl is-active --quiet "$service"
sudo systemctl enable "$service"
finished=true
printf '部署完成：%s %s %s\n' "$revision" "$service" "$base"
