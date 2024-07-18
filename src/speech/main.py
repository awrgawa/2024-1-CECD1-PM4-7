# STT main
from common import auth_
import STT

# Auth
auth_.googleSTTAuth()

# 변환
'''
    None 옵션은 프로그램 실행 중에 옵션을 선택할 수 있도록 함
    askFolder = True: 폴더를 선택하여 하위 모든 항목을 처리
            = False: 파일을 선택하여 처리
    makeTrainData = True: 변환 결과를 학습 데이터로도 생성
            = False: 학습 데이터를 생성하지 않음
'''


STT.STT_pipeline(
    askFolder=True,
    makeTrainData=True
)
