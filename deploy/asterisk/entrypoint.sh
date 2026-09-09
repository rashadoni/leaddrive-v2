#!/bin/sh
# Подставляет секреты из окружения в конфиги и стартует Asterisk.
#
# Asterisk не умеет читать переменные окружения из своих .conf, поэтому
# конфиги лежат шаблонами в /etc/asterisk/templates и рендерятся сюда при
# старте. Готовые файлы остаются только внутри контейнера — на диск с
# паролями ничего не пишется.
set -eu

TEMPLATE_DIR=/etc/asterisk/templates
TARGET_DIR=/etc/asterisk

for tpl in "$TEMPLATE_DIR"/*.conf; do
  [ -e "$tpl" ] || continue
  name=$(basename "$tpl")
  # envsubst только по нашим переменным: иначе он съест ${EXTEN} и прочий
  # синтаксис самого Asterisk в диалплане.
  envsubst '${TRUNK_PASSWORD} ${WEBRTC_PASSWORD} ${EXTERNAL_IP}' \
    < "$tpl" > "$TARGET_DIR/$name"
  chmod 640 "$TARGET_DIR/$name"
done

exec asterisk -f -vvv
