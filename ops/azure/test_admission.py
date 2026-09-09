import contextlib,io,json,os,runpy,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
REPO='d19677b2-8f20-4999-b1ec-e36780932716'
SHA='a'*40
class AdmissionTests(unittest.TestCase):
 def documents(self):
  scope=[{'repositoryId':REPO,'refName':'refs/heads/main','matchKind':'Exact'}]
  return [
   {'reason':'buildCompletion','triggeredByBuild':{'id':20},'definition':{'id':7}},
   {'definition':{'id':5,'revision':3},'repository':{'id':REPO,'type':'TfsGit'},'status':'completed','result':'succeeded','sourceBranch':'refs/heads/main','sourceVersion':SHA},
   {'value':[{'name':'refs/heads/main','objectId':SHA}]},
   {'value':[{'isEnabled':True,'isBlocking':True,'type':{'id':'0609b952-1397-4640-95ec-e00a01b2c241'},'settings':{'buildDefinitionId':d,'scope':scope,'manualQueueOnly':False}} for d in [4,6]]},
   {'value':[{'pullRequestId':43,'status':'completed','lastMergeCommit':{'commitId':SHA}}]},
   {'value':[{'status':'approved','configuration':{'settings':{'buildDefinitionId':d}},'context':{'buildId':d+100}} for d in [4,6]]},
   *[{'definition':{'id':d,'revision':4},'repository':{'id':REPO},'status':'completed','result':'succeeded','reason':'pullRequest'} for d in [4,6]]
  ]
 def execute(self,docs):
  env={'BUILD_SOURCEBRANCH':'refs/heads/main','BUILD_TRIGGEREDBY_BUILDID':'20','BUILD_BUILDID':'21','SYSTEM_ACCESSTOKEN':'test-not-a-secret','LD_PRODUCTION_DEFINITION':'7','LD_RELEASE_BUILD_DEFINITION':'5','LD_RELEASE_DEFINITION_REVISION':'3','LD_CHECKS_DEFINITION':'4','LD_REVIEW_DEFINITION':'6','LD_CHECKS_DEFINITION_REVISION':'4','LD_REVIEW_DEFINITION_REVISION':'4'}
  replies=[io.BytesIO(json.dumps(d).encode()) for d in docs]
  with patch.dict(os.environ,env),patch('urllib.request.urlopen',side_effect=replies),contextlib.redirect_stdout(io.StringIO()) as output:
   runpy.run_path(str(HERE/'deploy-admission.py'))
  return output.getvalue()
 def test_admits_exact_successful_source(self):
  self.assertIn('DEPLOY_TARGET_SHA',self.execute(self.documents()))
 def test_rejects_manual_production(self):
  d=self.documents();d[0]['reason']='manual'
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_other_build(self):
  d=self.documents();d[0]['triggeredByBuild']['id']=19
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_definition_drift(self):
  d=self.documents();d[1]['definition']['revision']=4
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_superseded_main(self):
  d=self.documents();d[2]['value'][0]['objectId']='b'*40
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_missing_review_policy(self):
  d=self.documents();d[3]['value']=d[3]['value'][:1]
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_direct_main_push(self):
  d=self.documents();d[4]['value']=[]
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_bypassed_pr(self):
  d=self.documents();d[4]['value'][0]['completionOptions']={'bypassPolicy':True}
  with self.assertRaises(RuntimeError):self.execute(d)
 def test_rejects_altered_review_definition(self):
  d=self.documents();d[7]['definition']['revision']=5
  with self.assertRaises(RuntimeError):self.execute(d)
if __name__=='__main__':unittest.main()
