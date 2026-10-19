#!/bin/sh
# End-to-end check of a running instance. Usage: ./scripts/smoke.sh https://24nova-ai.ru
set -eu
BASE=${1:-http://localhost}
API="$BASE/api/v1"
# No EXIT trap: some /bin/sh run it when every $(...) subshell exits, deleting the jar mid-test.
JAR=$(mktemp)
EMAIL="smoke-$(date +%s)@example.com"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1 (ожидалось $3, получено $2)"; fi; }
code() { curl -s ${SMOKE_INSECURE:+-k} -o /dev/null -w '%{http_code}' "$@"; }

echo "Smoke test: $BASE"
check "главная страница"        "$(code "$BASE/")" 200
check "SPA-маршрут /app/chat"    "$(code "$BASE/app/chat")" 200
check "health API"              "$(code "$BASE/api/health")" 200
check "публичный конфиг"        "$(code "$API/public/config")" 200
check "модели"                  "$(code "$API/models")" 200
check "пакеты"                  "$(code "$API/billing/packages")" 200
check "оценки"                  "$(code "$API/billing/estimates")" 200
check "услуги"                  "$(code "$API/services")" 200
check "без входа /me → 401"     "$(code "$API/me")" 401
check "админка без входа → 401" "$(code "$API/admin/overview")" 401
# JSON is built outside "$(...)": old /bin/sh mangles escaped quotes inside command substitution.
REGISTER='{"email":"'$EMAIL'","name":"Smoke","password":"smoke-password-1","terms":true}'
FORGOT='{"email":"'$EMAIL'"}'
JSON='content-type: application/json'
check "регистрация"             "$(code -c "$JAR" -H "$JSON" -d "$REGISTER" "$API/auth/register")" 201
check "профиль"                 "$(code -b "$JAR" "$API/me")" 200
check "админка обычному → 403"  "$(code -b "$JAR" "$API/admin/overview")" 403
check "реферальная ссылка"      "$(code -b "$JAR" "$API/referral")" 200
check "создание чата"           "$(code -b "$JAR" -H "$JSON" -d '{}' "$API/chats")" 201
TICKET='{"subject":"Smoke test","message":"Проверка тикетов"}'
check "создание обращения"       "$(code -b "$JAR" -H "$JSON" -d "$TICKET" "$API/tickets")" 201
check "список обращений"         "$(code -b "$JAR" "$API/tickets")" 200
check "обращения админа → 403"   "$(code -b "$JAR" "$API/admin/tickets")" 403
check "восстановление пароля"   "$(code -H "$JSON" -d "$FORGOT" "$API/auth/forgot")" 202
check "выход"                   "$(code -b "$JAR" -X POST "$API/auth/logout")" 204
case "$BASE" in https://*:*) ;; https://*)  # only meaningful on the standard ports 80/443
  check "редирект http → https" "$(code "http://${BASE#https://}/")" 308 ;;
esac
rm -f "$JAR"
echo "Итого: $pass ok, $fail fail"
[ "$fail" -eq 0 ]
