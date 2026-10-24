import subprocess

from mini_agent.ui import CYAN, RESET

BASH_TOOL = {
    "type": "function",
    "function": {
        "name": "bash",
        "description": "在独立、非交互的 bash 进程中执行命令。返回退出码和输出。",
        "parameters": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
}


def run_bash(command):
    print(f"\n{CYAN}$ {command}{RESET}", flush=True)
    try:
        result = subprocess.run(
            ["bash", "-c", command],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            timeout=60,
        )
        output = f"exit_code: {result.returncode}\n\n{result.stdout}"
    except subprocess.TimeoutExpired:
        output = "命令超时。"
    print(output, flush=True)
    return output
