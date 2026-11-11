#!/bin/sh
# WhatsApp SIP relay: hand the renewed certificate to Asterisk (transport-tls allow_reload=yes).
case "$RENEWED_DOMAINS" in *wa-sip.leaddrivecrm.org*) ;; *) exit 0 ;; esac
install -o asterisk -g asterisk -m 0640 "$RENEWED_LINEAGE/fullchain.pem" /etc/asterisk/keys/wa-sip.crt
install -o asterisk -g asterisk -m 0640 "$RENEWED_LINEAGE/privkey.pem" /etc/asterisk/keys/wa-sip.key
systemctl is-active --quiet asterisk && asterisk -rx "module reload res_pjsip.so" >/dev/null || true
