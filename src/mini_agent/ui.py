import subprocess

GRAY = "\033[90m"
CYAN = "\033[36m"
RESET = "\033[0m"


def banner():
    try:
        subprocess.run(["toilet", "-f", "mono9", "Agent"], check=False)
    except FileNotFoundError:
        print("MiniAgent")


def prompt() -> str:
    return input(f"\n{CYAN}>>> {RESET}").strip()
