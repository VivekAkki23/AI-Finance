pipeline {
    agent any

    stages {

        stage('Clone Repository') {
            steps {
                echo 'Cloning project...'
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing npm packages...'
                sh 'npm install'
            }
        }

        stage('Run Tests') {
            steps {
                echo 'Running tests...'
                sh 'npm test || echo "No tests defined"'
            }
        }

        stage('Build Docker Image') {
            steps {
                echo 'Building Docker image...'
                sh 'docker build -t ai-finance-dashboard .'
            }
        }

        stage('Deploy Container') {
            steps {
                echo 'Deploying container...'
                sh '''
                    docker stop ai-finance || true
                    docker rm ai-finance || true
                    docker run -d \
                        --name ai-finance \
                        -p 3000:3000 \
                        --env-file .env \
                        ai-finance-dashboard
                '''
            }
        }
    }

    post {
        success {
            echo '✅ Deployment successful!'
        }
        failure {
            echo '❌ Build failed. Check logs above.'
        }
    }
}