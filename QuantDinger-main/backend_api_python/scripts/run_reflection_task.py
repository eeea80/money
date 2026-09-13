import sys
import os
from dotenv import load_dotenv

# 添加后端目录到 Python 路径（使得可以 import app.*）
# 由于 app 包位于 backend_api_python/app 下，而脚本位于 backend_api_python/scripts
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.reflection import ReflectionService

def main():
    # Load backend envs for DATABASE_URL, reflection switches, etc.
    # This script may be run locally, so we must load .env explicitly.
    backend_env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '.env'))
    root_env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))
    if os.path.exists(root_env_path):
        load_dotenv(root_env_path, override=False)
    if os.path.exists(backend_env_path):
        load_dotenv(backend_env_path, override=False)

    """
    运行自动反思验证任务
    建议通过 cron 或 定时任务调度器 每天运行一次
    """
    print("Running Automated Reflection Verification Task...")
    service = ReflectionService()
    stats = service.run_verification_cycle()
    print("Reflection stats:", stats)
    print("Task Completed.")

if __name__ == "__main__":
    main()

