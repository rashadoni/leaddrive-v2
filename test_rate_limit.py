import requests
import random
import string
from collections import Counter

TARGET = "https://v2.leaddrivecrm.org/api/v1/auth/verify-2fa"
SESSION_COOKIE = "__Secure-authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIiwia2lkIjoiaDVNSG5IbEhiR05OUU15MmRsSVFULUx6QnNGVGFLNFJCWkQ4VGJwX3NTSWpYVENTU0Q0YmswTzdmMExmemdraW5MZ0FYX3FPY2hpZ2ZGLVFUdjNjLWcifQ..NocJtDfhqQwcgLNLQwIbMw.HTEfkrFBOV1dfa9kddJp8uEXuRjUAZxjIzaOovfrZkZt2iX53P0xMSiaz83DxlZh-oPMDZ5V6ix9TKgRPd-nvhyCOBz8Cv6x90YIbbOET3KfLxCrlfC4HrxaIbyRP9ozUDEIAb1ubarxkbmAd1Y7KZK7SYPuz1L4Kzm5KO_oAlCgaa7IvFeLbuapeUzlYadp_tSl9vcivxPdOurtUljeW7viHpok92z3iAyK2JdyU897Ja3w0u68Jc9BH3vC9xBcQCMARb_y5Ovb6EOuL80dQ-ZL22mN1e1e9qh3EsSRMPEpEokrlHcPlIwE6WCXGj-Me7zXo1m2o5GD9UxMA8k2AV1bdCciOUrn0ojJm-M9vfuxMsYDn3CfA6wcefmMnhI0At-YjEUR4JToAPtdzx349FgwcKYBC9g4KhUrL7f5xmN13VNs5V_od7n7PH6ahpcz.CkVLJkp7RW0aQyidAI1Ll0IHBtqxXkVp28reOe92W3Y"

NUM_REQUESTS = 25
HEX_CHARS = string.hexdigits[:16]  # 0-9 and a-f


def random_hex_code(length=8):
    return ''.join(random.choices(HEX_CHARS, k=length))


def run_test():
    print("=" * 60)
    print("Rate Limit Test: POST /api/v1/auth/verify-2fa")
    print(f"Sending {NUM_REQUESTS} rapid requests...")
    print("=" * 60)

    headers = {
        "Content-Type": "application/json",
        "Cookie": SESSION_COOKIE,
    }

    status_counts = Counter()

    for i in range(1, NUM_REQUESTS + 1):
        code = random_hex_code()
        payload = {"code": code}
        try:
            response = requests.post(TARGET, json=payload, headers=headers, timeout=10)
            status = response.status_code
        except Exception as e:
            status = f"ERROR({e})"

        status_counts[status] += 1
        print(f"Attempt {i:2d} | code: {code} | status: {status}")

    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for status, count in sorted(status_counts.items(), key=lambda x: str(x[0])):
        print(f"  HTTP {status}: {count} response(s)")

    print()
    rate_limited = status_counts.get(429, 0)
    if rate_limited == 0:
        print(f"CONCLUSION: NO RATE LIMITING CONFIRMED")
        print(f"  0 out of {NUM_REQUESTS} requests returned 429.")
    else:
        print(f"CONCLUSION: RATE LIMITING IS ACTIVE")
        print(f"  {rate_limited} out of {NUM_REQUESTS} requests returned 429.")
    print("=" * 60)


if __name__ == "__main__":
    run_test()
