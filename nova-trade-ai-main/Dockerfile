FROM maven:3.9.11-eclipse-temurin-21-alpine AS build

WORKDIR /workspace
COPY pom.xml ./
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S nova && adduser -S nova -G nova
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar

USER nova:nova
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
