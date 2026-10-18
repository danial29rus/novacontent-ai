#!/bin/sh
# Fresh server → running site. Run as root from the cloned repo:
#   git clone <repo> /opt/nova && cd /opt/nova && sudo ./scripts/bootstrap.sh
# Safe to re-run: existing .env, data and certificates are kept.
set -eu
cd "$(dirname "$0")/.."
DOMAIN=${DOMAIN:-24nova-ai.ru}

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root: sudo ./scripts/bootstrap.sh"; exit 1; }

say "1/6 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null || { echo "Нужен Docker Compose v2"; exit 1; }
systemctl enable --now docker >/dev/null 2>&1 || true

say "2/6 Память и порты"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3500 ] && ! swapon --show | grep -q .; then
  echo "RAM ${mem_mb} МБ — добавляю swap 2 ГБ (нужен для сборки фронтенда)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  echo "ufw: открыты 22, 80, 443"
fi

say "3/6 Настройки (.env)"
if [ ! -f .env ]; then
  ./scripts/init-env.sh
  set_env() { [ -n "$2" ] && sed -i "s|^$1=.*|$1=$2|" .env; return 0; }
  ask_secret() { printf "  %s: " "$1"; stty -echo; read -r v; stty echo; echo; set_env "$2" "$v"; }
  if [ -t 0 ]; then
    echo "Введите ключи (Enter — пропустить, можно вписать позже в .env):"
    ask_secret "OPENAI_API_KEY" OPENAI_API_KEY
    ask_secret "Пароль ящика support@ (SMTP_PASSWORD)" SMTP_PASSWORD
    printf "  YOOKASSA_SHOP_ID: "; read -r v; set_env YOOKASSA_SHOP_ID "$v"
    ask_secret "YOOKASSA_SECRET_KEY" YOOKASSA_SECRET_KEY
  fi
else
  echo ".env уже есть — оставляю как есть"
fi

say "4/6 DNS $DOMAIN"
server_ip=$(curl -fsS4 --max-time 5 https://api.ipify.org || true)
dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')
echo "IP сервера: ${server_ip:-?}   A-запись $DOMAIN: ${dns_ip:-нет}"
if [ -z "$dns_ip" ] || [ "$dns_ip" != "$server_ip" ]; then
  echo "⚠ A-запись ещё не указывает на этот сервер. Сайт запустится, а HTTPS-сертификат Caddy"
  echo "  получит автоматически, как только DNS обновится (обычно 5–30 минут)."
fi

say "5/6 Сборка и запуск (первый раз 3–7 минут)"
docker compose up -d --build
printf "Жду готовности сервисов"
for _ in $(seq 1 90); do
  states=$(docker compose ps --format '{{.Service}}={{.Health}}' api web)
  case "$states" in *starting*|*unhealthy*|"") printf "."; sleep 4 ;; *) break ;; esac
done
echo; docker compose ps --format 'table {{.Service}}\t{{.Status}}'
if docker compose ps api --format '{{.Health}}' | grep -q unhealthy; then
  echo "API не поднялся. Причина в логах:"; docker compose logs --tail=40 api; exit 1
fi

say "6/6 Проверка https://$DOMAIN"
if [ -n "$dns_ip" ] && [ "$dns_ip" = "$server_ip" ]; then
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "https://$DOMAIN/api/health" 2>/dev/null && break; sleep 4; done
  ./scripts/smoke.sh "https://$DOMAIN" || echo "Смоук-тест не прошёл — смотрите ./scripts/logs.sh"
else
  echo "Пропускаю: DNS ещё не готов. Когда обновится — выполните ./scripts/smoke.sh https://$DOMAIN"
fi

admin_email=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2)
admin_password=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2)
cat <<INFO

✦ Готово.  https://$DOMAIN
  Админка:  https://$DOMAIN/login   $admin_email / $admin_password   (смените пароль в профиле)
  Бэкапы:   ежедневно в 04:00 МСК в /opt/nova/backups (статус — в админке)
  Логи:     ./scripts/logs.sh api
  Обновить: ./scripts/update.sh
INFO
grep -qE '^OPENAI_API_KEY=$' .env && echo "  ⚠ Не задан OPENAI_API_KEY — впишите в .env и выполните: docker compose up -d"
grep -qE '^SMTP_PASSWORD=$' .env && echo "  ⚠ Не задан SMTP_PASSWORD — письма не отправляются"
grep -qE '^YOOKASSA_SHOP_ID=$' .env && echo "  ⚠ ЮKassa не настроена — пополнение закрыто"
exit 0
