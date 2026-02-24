pipeline {
  agent any
  tools { nodejs '22' }
  options {
    buildDiscarder logRotator(daysToKeepStr: '30', numToKeepStr: '5')
  }
  triggers { githubPush() }
  stages {
    stage('Pack') {
      steps {
        checkout scm
        sh 'yarn --frozen-lockfile'
        sh 'npm pack'
        archiveArtifacts artifacts: '*.tgz', fingerprint: true
      }
    }
  }
}